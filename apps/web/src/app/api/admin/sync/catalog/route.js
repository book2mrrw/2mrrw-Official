import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { normalizeStoragePathForStorefront } from "@/lib/sync/normalize-storage-path";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { isAutoGenerateStreamAssetsEnabled } from "@/lib/feature-flags";
import { maybeGenerateStreamAfterCatalogSync } from "@/lib/media/stream-upload-pipeline";

function authorize(req) {
  const secret = req.headers.get("x-seed-secret");
  return Boolean(process.env.ADMIN_SEED_SECRET && secret === process.env.ADMIN_SEED_SECRET);
}

export async function POST(req) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit(req, {
    routeKey: "admin.sync.catalog",
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return rateLimitResponse(limit.retryAfterSeconds);
  }

  try {
    const body = await req.json();
    const vaultRows = Array.isArray(body.vaultContent) ? body.vaultContent : [];
    const productRows = Array.isArray(body.products) ? body.products : [];
    const admin = getAdminClient();

    const failed = [];
    let vaultUpserted = 0;

    for (const row of vaultRows) {
      if (!row?.slug) continue;
      const { error } = await admin.from("vault_content").upsert(
        {
          ...row,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" }
      );
      if (error) {
        failed.push({ slug: row.slug, kind: "vault", error: error.message });
        continue;
      }
      vaultUpserted += 1;
    }

    let productUpserted = 0;
    const streamAutoGenerateEnabled = isAutoGenerateStreamAssetsEnabled();
    const streamResults = [];

    for (const row of productRows) {
      if (!row?.slug) continue;
      const meta = row.metadata || {};
      const contentType = row.content_type ?? meta.content_type ?? null;
      const contentId = row.content_id ?? meta.content_id ?? null;
      const storagePath = normalizeStoragePathForStorefront(row.storage_path ?? meta.canonical_media_path);
      const previewPath = normalizeStoragePathForStorefront(row.preview_path);

      const payload = {
        slug: row.slug,
        title: row.title,
        product_type: row.product_type,
        price_cents: row.price_cents,
        cover_url: row.cover_url ?? null,
        storage_path: storagePath || null,
        preview_path: previewPath || null,
        content_type: contentType,
        content_id: contentId,
        gifting_enabled: row.gifting_enabled ?? meta.gifting_enabled ?? false,
        active: row.active ?? true,
        metadata: {
          ...meta,
          content_type: contentType,
          content_id: contentId,
          gifting_enabled: row.gifting_enabled ?? meta.gifting_enabled ?? false,
          canonical_media_path: storagePath || null,
        },
        updated_at: new Date().toISOString(),
      };

      const { error } = await admin.from("products").upsert(payload, { onConflict: "slug" });
      if (error) {
        failed.push({ slug: row.slug, kind: "product", error: error.message });
        continue;
      }
      productUpserted += 1;

      if (streamAutoGenerateEnabled && storagePath) {
        try {
          const streamOutcome = await maybeGenerateStreamAfterCatalogSync(admin, {
            slug: row.slug,
            storage_path: storagePath,
            product_type: row.product_type,
            metadata: payload.metadata,
          });
          if (!streamOutcome.skipped || streamOutcome.reason !== "auto_generate_disabled") {
            streamResults.push({ slug: row.slug, ...streamOutcome });
          }
        } catch (streamErr) {
          console.error("[admin/sync/catalog] stream generation error", {
            slug: row.slug,
            message: streamErr?.message,
          });
          streamResults.push({
            slug: row.slug,
            ok: false,
            error: streamErr?.message || "stream_generation_failed",
          });
        }
      }
    }

    return NextResponse.json({
      ok: failed.length === 0,
      vaultUpserted,
      productUpserted,
      failed,
      ...(streamAutoGenerateEnabled
        ? { streamAutoGenerateEnabled: true, streamResults }
        : {}),
      reason: body.reason || null,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("catalog sync ingest error:", err);
    return NextResponse.json({ error: err.message || "Catalog sync failed" }, { status: 500 });
  }
}
