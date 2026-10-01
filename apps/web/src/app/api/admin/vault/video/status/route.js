import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { folderForCategory } from "@/lib/vault/vault-upload-contract";
import { VAULT_RELEASE_TYPE } from "@/lib/vault/vault-job-identity";
import {
  submitVaultVideoJob,
  VaultVideoJobConflict,
  VaultVideoIdentityCollision,
} from "@/lib/vault/submit-vault-video-job";

export const dynamic = "force-dynamic";

/**
 * Transcode state for vault video.
 *
 * Derived from the job and manifest rows rather than mirrored into a column,
 * so a worker that died between two writes shows as stalled instead of as
 * whatever it last claimed.
 *
 * Every read is pinned to release_type='vault'. A release's rows are never
 * reported as a vault item's state even if the two ever shared a slug.
 */
export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = req.nextUrl.searchParams.get("category");
  const admin = getAdminClient();

  let itemQuery = admin
    .from("vault_content")
    .select("id, slug, category, title, visibility, access_tier, duration_seconds, media_storage_path, updated_at")
    .eq("media_type", "video")
    .order("updated_at", { ascending: false });

  if (category) {
    if (!folderForCategory(category)) {
      return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
    }
    itemQuery = itemQuery.eq("category", category);
  }

  const { data: items, error: itemErr } = await itemQuery;
  if (itemErr) {
    console.error("vault video status items failed:", itemErr);
    return NextResponse.json({ error: "Could not load vault video" }, { status: 500 });
  }
  if (!items?.length) return NextResponse.json({ items: [] });

  const slugs = items.map((i) => i.slug);
  const [{ data: jobs, error: jobErr }, { data: manifests, error: manErr }] = await Promise.all([
    admin
      .from("hls_transcode_jobs")
      .select("slug, status, attempt_count, error_message, failure_category, completed_at")
      .eq("job_type", "vault_video")
      .eq("release_type", VAULT_RELEASE_TYPE)
      .is("track_slug", null)
      .in("slug", slugs),
    admin
      .from("hls_manifests")
      .select("slug, bitrates, duration_seconds, hls_prefix, updated_at")
      .eq("release_type", VAULT_RELEASE_TYPE)
      .is("track_slug", null)
      .in("slug", slugs),
  ]);

  if (jobErr || manErr) {
    console.error("vault video status join failed:", jobErr || manErr);
    return NextResponse.json({ error: "Could not load transcode state" }, { status: 500 });
  }

  const jobBySlug = new Map((jobs || []).map((j) => [j.slug, j]));
  const manBySlug = new Map((manifests || []).map((m) => [m.slug, m]));

  return NextResponse.json({
    items: items.map((item) => {
      const job = jobBySlug.get(item.slug) || null;
      const manifest = manBySlug.get(item.slug) || null;
      return {
        ...item,
        streamable: Boolean(manifest),
        job: job && {
          status: job.status,
          attempts: job.attempt_count,
          error: job.error_message,
          failureCategory: job.failure_category,
          completedAt: job.completed_at,
        },
        manifest: manifest && {
          bitrates: manifest.bitrates,
          durationSeconds: manifest.duration_seconds,
          hlsPrefix: manifest.hls_prefix,
          updatedAt: manifest.updated_at,
        },
      };
    }),
  });
}

/**
 * Queues an item for streaming, or re-queues a failed one.
 *
 * The source is the file Vault Manager already uploaded, so this encodes the
 * bytes that are there rather than asking for them again.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.video.queue",
    limit: 20,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = String(body?.slug || "");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const admin = getAdminClient();
  const { data: item, error } = await admin
    .from("vault_content")
    .select("slug, category, media_type, media_storage_path")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("vault video queue lookup failed:", error);
    return NextResponse.json({ error: "Could not load the item" }, { status: 500 });
  }
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (item.media_type !== "video") {
    return NextResponse.json({ error: "Not a video item" }, { status: 400 });
  }
  if (!item.media_storage_path) {
    return NextResponse.json({ error: "This item has no uploaded file to encode" }, { status: 400 });
  }

  try {
    const job = await submitVaultVideoJob({
      admin,
      category: item.category,
      slug: item.slug,
      sourceKey: item.media_storage_path,
      queuedBy: user.id,
    });
    return NextResponse.json({
      ok: true,
      job: { id: job.id, status: job.status, hlsPrefix: job.hls_prefix, reused: Boolean(job.reused) },
    });
  } catch (err) {
    if (err instanceof VaultVideoIdentityCollision || err instanceof VaultVideoJobConflict) {
      return NextResponse.json({ error: err.message }, { status: err.status || 409 });
    }
    console.error("vault video queue failed:", err);
    return NextResponse.json({ error: "Could not queue transcoding" }, { status: 500 });
  }
}
