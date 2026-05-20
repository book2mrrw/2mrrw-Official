import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function authorize(req) {
  const secret = req.headers.get("x-seed-secret");
  return Boolean(process.env.ADMIN_SEED_SECRET && secret === process.env.ADMIN_SEED_SECRET);
}

export async function POST(req) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const vaultRows = Array.isArray(body.vaultContent) ? body.vaultContent : [];
    const productRows = Array.isArray(body.products) ? body.products : [];
    const admin = createAdminClient();

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
      if (!error) vaultUpserted += 1;
    }

    let productUpserted = 0;
    for (const row of productRows) {
      if (!row?.slug) continue;
      const payload = {
        slug: row.slug,
        title: row.title,
        product_type: row.product_type,
        price_cents: row.price_cents,
        cover_url: row.cover_url ?? null,
        storage_path: row.storage_path ?? null,
        preview_path: row.preview_path ?? null,
        active: row.active ?? true,
        metadata: {
          ...(row.metadata || {}),
          gifting_enabled: row.gifting_enabled ?? false,
        },
        updated_at: new Date().toISOString(),
      };

      const { error } = await admin.from("products").upsert(payload, { onConflict: "slug" });
      if (!error) productUpserted += 1;
    }

    return NextResponse.json({
      ok: true,
      vaultUpserted,
      productUpserted,
      reason: body.reason || null,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("catalog sync ingest error:", err);
    return NextResponse.json({ error: err.message || "Catalog sync failed" }, { status: 500 });
  }
}
