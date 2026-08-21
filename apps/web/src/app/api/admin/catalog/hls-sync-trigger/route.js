/**
 * POST /api/admin/catalog/hls-sync-trigger
 *
 * Session-authenticated admin trigger: re-queue all catalog tracks for HLS
 * transcoding. Skips tracks that are already pending or processing.
 * Tracks with updated audio files in R2 get re-transcoded when re-queued.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { isAdminUser } from "@/lib/auth/constants";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";
import { buildHLSPrefix } from "@/lib/hls/derive-key";

export const dynamic = "force-dynamic";

const RELEASE_TYPE_MAP = {
  single: "singles",
  singles: "singles",
  album: "albums",
  albums: "albums",
  feature: "features",
  features: "features",
  mixtape: "mixtapes-and-eps",
  "mixtapes-and-eps": "mixtapes-and-eps",
  ep: "eps",
  eps: "eps",
  vault: "vault",
};

export async function POST() {
  const cookieStore = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await sb.auth.getUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();

  try {
  const { data: tracks, error: fetchErr } = await admin
    .from("catalog_tracks")
    .select("slug, album_slug, metadata")
    .order("album_slug");

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!tracks?.length) {
    return NextResponse.json({ ok: true, queued: 0, skipped: 0, failed: 0, message: "No catalog tracks found" });
  }

  const results = [];
  const errors = [];

  for (const t of tracks) {
    const releaseSlug = t.album_slug || t.slug;
    // Only set trackSlug for multi-track releases (where album_slug is set and differs from the track slug)
    const trackSlug = t.album_slug ? t.slug : null;
    const rawType = t.metadata?.release_category || t.metadata?.release_type || "single";
    const releaseType = RELEASE_TYPE_MAP[rawType] || "singles";

    if (!releaseSlug) {
      errors.push({ slug: t.slug, error: "no release slug" });
      continue;
    }

    // Skip tracks already in-flight — don't interrupt an active job
    let q = admin
      .from("hls_transcode_jobs")
      .select("id, status")
      .eq("slug", releaseSlug);
    q = trackSlug ? q.eq("track_slug", trackSlug) : q.is("track_slug", null);
    const { data: existing } = await q.maybeSingle();

    if (existing?.status === "pending" || existing?.status === "processing") {
      results.push({ slug: releaseSlug, trackSlug, jobId: existing.id, status: existing.status, skipped: true });
      continue;
    }

    // Resolve source audio key from R2 (uses TTL cache — fast on warm instances)
    const sourceKey = await resolvePlaybackKey(admin, releaseSlug, {
      trackSlug: trackSlug || undefined,
      preferMaster: true,
    }).then((r) => r?.key || null).catch(() => null);

    if (!sourceKey) {
      errors.push({ slug: releaseSlug, trackSlug, error: "Could not resolve source audio key" });
      continue;
    }

    const hlsPrefix = buildHLSPrefix(releaseSlug, trackSlug, releaseType);

    if (existing) {
      const { data, error: upErr } = await admin
        .from("hls_transcode_jobs")
        .update({
          source_key: sourceKey,
          hls_prefix: hlsPrefix,
          release_type: releaseType,
          status: "pending",
          priority: 3,
          attempt_count: 0,
          error_message: null,
          worker_id: null,
          queued_by: user.id,
          started_at: null,
          completed_at: null,
        })
        .eq("id", existing.id)
        .select("id, status")
        .single();
      if (upErr) errors.push({ slug: releaseSlug, trackSlug, error: upErr.message });
      else results.push({ slug: releaseSlug, trackSlug, jobId: data.id, status: data.status });
    } else {
      const { data, error: insErr } = await admin
        .from("hls_transcode_jobs")
        .insert({
          slug: releaseSlug,
          track_slug: trackSlug,
          release_type: releaseType,
          source_key: sourceKey,
          hls_prefix: hlsPrefix,
          status: "pending",
          priority: 3,
          attempt_count: 0,
          error_message: null,
          worker_id: null,
          queued_by: user.id,
          started_at: null,
          completed_at: null,
        })
        .select("id, status")
        .single();
      if (insErr) errors.push({ slug: releaseSlug, trackSlug, error: insErr.message });
      else results.push({ slug: releaseSlug, trackSlug, jobId: data.id, status: data.status });
    }
  }

  const queued = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;

  return NextResponse.json({
    ok: true,
    queued,
    skipped,
    failed: errors.length,
    jobs: results,
    errors,
  });
  } catch (err) {
    console.error("[hls-sync-trigger] unhandled error", err?.message);
    return NextResponse.json({ ok: false, error: err?.message || "Internal error" }, { status: 500 });
  }
}
