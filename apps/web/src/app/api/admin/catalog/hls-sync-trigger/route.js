/**
 * POST /api/admin/catalog/hls-sync-trigger
 *
 * Session-authenticated admin trigger: scan R2 directly for all audio files
 * across every release type (singles, features, albums, mixtapes-and-eps),
 * clear stale playback caches, and re-queue HLS transcode jobs for every track
 * that has audio in R2.
 *
 * R2 is the source of truth — not the DB. This means newly added or manually
 * replaced audio files are picked up automatically without a prior Sync Catalog.
 * Wizard draft releases (status != "published") are skipped.
 * Tracks with jobs already pending/processing are cache-cleared but not re-queued.
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/auth/constants";
import { resolvePlaybackKey, clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";
import { buildHLSPrefix } from "@/lib/hls/derive-key";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const RELEASE_TYPE_FOLDERS = ["singles", "features", "albums", "mixtapes-and-eps"];
const MULTI_TRACK_FOLDERS = new Set(["albums", "mixtapes-and-eps"]);
const AUDIO_EXTENSIONS = [".wav", ".flac", ".m4a", ".mp3"];

async function listR2Subfolders(prefix) {
  if (!R2_BUCKET) return [];
  const normalized = String(prefix || "").replace(/^\//, "");
  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const subfolders = [];
  let continuationToken;
  do {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: listPrefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );
    for (const cp of response.CommonPrefixes || []) {
      if (cp.Prefix) {
        const slug = cp.Prefix.replace(listPrefix, "").replace(/\/$/, "").trim();
        if (slug) subfolders.push(slug);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return subfolders;
}

async function hasAudioFile(prefix) {
  if (!R2_BUCKET) return false;
  const normalized = String(prefix || "").replace(/^\//, "");
  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  try {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: listPrefix,
        Delimiter: "/",
        MaxKeys: 20,
      })
    );
    return (response.Contents || [])
      .map((item) => item.Key || "")
      .some((key) => AUDIO_EXTENSIONS.some((ext) => key.toLowerCase().endsWith(ext)));
  } catch {
    return false;
  }
}

export async function POST() {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();

  try {
    // Scan R2 directly for all audio files — R2 is the source of truth.
    // allTracks: Map keyed by `${releaseSlug}::${trackSlug|""}` → { releaseSlug, trackSlug, releaseType }
    const allTracks = new Map();

    for (const folder of RELEASE_TYPE_FOLDERS) {
      const releaseSlugs = await listR2Subfolders(`digital-assets/${folder}`);

      for (const releaseSlug of releaseSlugs) {
        // Skip wizard releases that are not yet published
        const { data: wizardRow } = await admin
          .from("releases").select("status").eq("slug", releaseSlug).maybeSingle();
        if (wizardRow && wizardRow.status !== "published") continue;

        if (MULTI_TRACK_FOLDERS.has(folder)) {
          // Albums / mixtapes-and-eps: each sub-folder is a track
          const trackSlugs = await listR2Subfolders(`digital-assets/${folder}/${releaseSlug}`);
          for (const trackSlug of trackSlugs) {
            const hasAudio = await hasAudioFile(`digital-assets/${folder}/${releaseSlug}/${trackSlug}`);
            if (!hasAudio) continue;
            allTracks.set(`${releaseSlug}::${trackSlug}`, { releaseSlug, trackSlug, releaseType: folder });
          }
        } else {
          // Singles / features: release folder IS the audio folder
          const hasAudio = await hasAudioFile(`digital-assets/${folder}/${releaseSlug}`);
          if (!hasAudio) continue;
          allTracks.set(`${releaseSlug}::`, { releaseSlug, trackSlug: null, releaseType: folder });
        }
      }
    }

    if (allTracks.size === 0) {
      return NextResponse.json({ ok: true, queued: 0, skipped: 0, failed: 0, message: "No audio files found in R2" });
    }

    const results = [];
    const errors = [];

    for (const { releaseSlug, trackSlug, releaseType } of allTracks.values()) {
      // Always clear stale durable playback cache first — audio may have been
      // manually replaced in R2 even while a job is pending/processing
      try { await clearPersistedPlaybackKey(admin, releaseSlug, trackSlug || null); } catch {}

      // Check for an existing in-flight job — don't interrupt active work
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

      // Resolve source audio key from R2 / DB
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

    const queued  = results.filter((r) => !r.skipped).length;
    const skipped = results.filter((r) =>  r.skipped).length;

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
