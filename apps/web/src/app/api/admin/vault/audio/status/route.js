import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { folderForCategory } from "@/lib/vault/vault-upload-contract";
import { VAULT_AUDIO_RELEASE_TYPE } from "@/lib/vault/vault-audio-contract";
import {
  submitVaultAudioJob,
  VaultAudioJobConflict,
  VaultAudioIdentityCollision,
} from "@/lib/vault/submit-vault-audio-job";

export const dynamic = "force-dynamic";

/**
 * Transcode state for vault audio items.
 *
 * Derived from the job and manifest rows rather than mirrored into a column of
 * its own: a status column would be a second source of truth that goes stale
 * the moment a worker crashes between updating one and the other.
 *
 * Every read is filtered to release_type = 'vault'. A release's job row is
 * never reported as a vault item's status even if the two ever shared a slug.
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
    .eq("media_type", "audio")
    .order("updated_at", { ascending: false });

  if (category) {
    if (!folderForCategory(category)) {
      return NextResponse.json({ error: "Unknown vault section" }, { status: 400 });
    }
    itemQuery = itemQuery.eq("category", category);
  }

  const { data: items, error: itemErr } = await itemQuery;
  if (itemErr) {
    console.error("vault audio status items failed:", itemErr);
    return NextResponse.json({ error: "Could not load vault audio" }, { status: 500 });
  }
  if (!items?.length) return NextResponse.json({ items: [] });

  const slugs = items.map((i) => i.slug);

  const [{ data: jobs, error: jobErr }, { data: manifests, error: manErr }] = await Promise.all([
    admin
      .from("hls_transcode_jobs")
      .select("slug, status, attempt_count, error_message, failure_category, hls_prefix, bitrates, completed_at")
      .eq("release_type", VAULT_AUDIO_RELEASE_TYPE)
      .is("track_slug", null)
      .in("slug", slugs),
    admin
      .from("hls_manifests")
      .select("slug, bitrates, duration_seconds, segment_counts, hls_prefix, updated_at")
      .eq("release_type", VAULT_AUDIO_RELEASE_TYPE)
      .is("track_slug", null)
      .in("slug", slugs),
  ]);

  if (jobErr || manErr) {
    console.error("vault audio status join failed:", jobErr || manErr);
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
 * Re-queues an item's existing master. For a job that failed its three
 * attempts, or one whose output needs regenerating after a ladder change.
 *
 * Re-uploading is not required -- the master is still in storage, and this
 * reuses that exact object so a retry encodes identical bytes.
 */
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.vault.audio.requeue",
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
    console.error("vault audio requeue lookup failed:", error);
    return NextResponse.json({ error: "Could not load the item" }, { status: 500 });
  }
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (item.media_type !== "audio") {
    return NextResponse.json({ error: "Not an audio item" }, { status: 400 });
  }
  if (!item.media_storage_path) {
    return NextResponse.json({ error: "This item has no master to re-encode" }, { status: 400 });
  }

  try {
    const job = await submitVaultAudioJob({
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
    if (err instanceof VaultAudioIdentityCollision || err instanceof VaultAudioJobConflict) {
      return NextResponse.json({ error: err.message }, { status: err.status || 409 });
    }
    console.error("vault audio requeue failed:", err);
    return NextResponse.json({ error: "Could not queue transcoding" }, { status: 500 });
  }
}
