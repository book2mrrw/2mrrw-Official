/**
 * POST /api/admin/catalog/hls-sync-trigger
 *
 * Session-authenticated admin trigger: re-queue all catalog tracks for HLS
 * transcoding. Scans BOTH the old catalog system (catalog_tracks) AND the
 * new upload wizard system (releases + tracks). Deduplicates by release slug
 * + track slug, then queues/updates hls_transcode_jobs for every track found.
 * Skips tracks that are already pending or processing.
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/auth/constants";
import { resolvePlaybackKey, clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";
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
  ep: "mixtapes-and-eps",
  eps: "mixtapes-and-eps",
  vault: "vault",
};

export async function POST() {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();

  try {
    // allTracks: Map keyed by `${releaseSlug}::${trackSlug|""}` → { releaseSlug, trackSlug, releaseType }
    // New system (releases+tracks) wins on conflict — it has explicit audio_r2_key.
    const allTracks = new Map();

    // ── Old system: catalog_tracks ────────────────────────────────────────────
    const { data: catalogTracks, error: catalogErr } = await admin
      .from("catalog_tracks")
      .select("slug, album_slug, metadata")
      .order("album_slug");

    if (catalogErr) {
      console.error("[hls-sync-trigger] catalog_tracks fetch error", catalogErr.message);
    } else {
      for (const t of catalogTracks || []) {
        const releaseSlug = t.album_slug || t.slug;
        const trackSlug = t.album_slug ? t.slug : null;
        const rawType = t.metadata?.release_category || t.metadata?.release_type || "single";
        const releaseType = RELEASE_TYPE_MAP[rawType] || "singles";
        if (!releaseSlug) continue;
        const key = `${releaseSlug}::${trackSlug || ""}`;
        allTracks.set(key, { releaseSlug, trackSlug, releaseType });
      }
    }

    // ── New system: releases + tracks ─────────────────────────────────────────
    const { data: newTracks, error: newErr } = await admin
      .from("tracks")
      .select("slug, audio_r2_key, releases!inner(slug, release_type)")
      .not("audio_r2_key", "is", null);

    if (newErr) {
      console.error("[hls-sync-trigger] releases+tracks fetch error", newErr.message);
    } else {
      for (const t of newTracks || []) {
        const rel = Array.isArray(t.releases) ? t.releases[0] : t.releases;
        if (!rel?.slug) continue;
        const isMulti = ["album", "ep", "mixtape"].includes(rel.release_type);
        const releaseSlug = rel.slug;
        const trackSlug = isMulti ? t.slug : null;
        const releaseType = RELEASE_TYPE_MAP[rel.release_type] || "singles";
        const key = `${releaseSlug}::${trackSlug || ""}`;
        // New system wins — overwrite any entry from old system
        allTracks.set(key, { releaseSlug, trackSlug, releaseType });
      }
    }

    if (allTracks.size === 0) {
      return NextResponse.json({ ok: true, queued: 0, skipped: 0, failed: 0, message: "No catalog tracks found in either system" });
    }

    const results = [];
    const errors = [];

    for (const { releaseSlug, trackSlug, releaseType } of allTracks.values()) {
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

      // Clear stale durable cache so resolvePlaybackKey re-discovers the current R2 audio
      // (handles audio replacements where the cached key may be outdated)
      try { await clearPersistedPlaybackKey(admin, releaseSlug, trackSlug || null); } catch {}

      // Resolve source audio key (never modify resolvePlaybackKey)
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
      total: allTracks.size,
      jobs: results,
      errors,
    });
  } catch (err) {
    console.error("[hls-sync-trigger] unhandled error", err?.message);
    return NextResponse.json({ ok: false, error: err?.message || "Internal error" }, { status: 500 });
  }
}
