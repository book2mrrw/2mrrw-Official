/**
 * POST /api/admin/audio-visual/upload/complete
 *
 * Audio Visualz's own, fully separate completion route — the counterpart to
 * ./presigned/route.js. Never a branch inside
 * src/app/api/admin/upload/complete/route.js, for the same reason: that
 * route's shape (releaseId/trackId/releaseType/slug) has no meaningful
 * mapping onto a stable-ID-only audio_visuals row.
 *
 * av-master completion is the actual ingestion trigger for the whole video
 * pipeline: it's the one place that creates an audio_visual_asset_versions
 * row and enqueues the hls_transcode_jobs row the video worker's
 * type-scoped claim query picks up. Everything from Slice 7 (SourceAnalyzer)
 * through Slice 15 (video-transcoder.js) exists only to eventually be
 * reached from here.
 *
 * createAssetVersion()'s equivalent insert is re-implemented here rather
 * than imported from workers/hls-transcoder/src/engine/publication-
 * authority.js — the web app and the worker are separate deployables with
 * no shared module path (the same reason derive-key.js/video-token.js
 * duplicate the worker's key derivation instead of importing it).
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { ADMIN_UPLOAD_CONTRACTS } from "@/lib/media/admin-upload-contract";
import { emitServerEvent } from "@/lib/observability/server-events";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visual.upload.complete",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { videoId, assetType, key, durationSeconds } = body;
  if (!videoId || !key || !assetType) {
    return NextResponse.json({ error: "videoId, key, and assetType are required" }, { status: 400 });
  }

  let exists = false;
  try {
    exists = await headR2ObjectKey(key);
  } catch (err) {
    emitServerEvent("error", "admin_audio_visual_upload_storage_verification_failed", { videoId, assetType, objectKey: key }, err);
    return NextResponse.json({ error: "R2 verification failed" }, { status: 502 });
  }
  if (!exists) {
    return NextResponse.json({ error: "File not found in R2 — upload may have failed" }, { status: 422 });
  }

  const admin = getAdminClient();

  const { data: audioVisual, error: avErr } = await admin
    .from("audio_visuals")
    .select("id, poster_r2_key, metadata")
    .eq("id", videoId)
    .maybeSingle();
  if (avErr) {
    emitServerEvent("error", "admin_audio_visual_upload_completion_failed", { videoId, assetType }, avErr);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!audioVisual) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  try {
    if (assetType === "av-cover") {
      const { error } = await admin.from("audio_visuals").update({ poster_r2_key: key }).eq("id", videoId);
      if (error) throw error;
      return NextResponse.json({ ok: true, assetType });
    }

    if (assetType === "av-cover-video") {
      const maxDuration = ADMIN_UPLOAD_CONTRACTS["av-cover-video"].maxDurationSeconds;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDuration + 0.5) {
        return NextResponse.json({ error: `Cover video must be no longer than ${Math.round(maxDuration / 60)} minutes` }, { status: 400 });
      }
      const meta = (audioVisual.metadata && typeof audioVisual.metadata === "object") ? audioVisual.metadata : {};
      const { error } = await admin.from("audio_visuals")
        .update({ metadata: { ...meta, animated_cover_r2_key: key } })
        .eq("id", videoId);
      if (error) throw error;
      return NextResponse.json({ ok: true, assetType });
    }

    if (assetType === "av-master") {
      // Always a NEW version row — never an in-place overwrite. Replacing a
      // published video's master is just this, on a row that already has a
      // current_version_id; the old version keeps serving, untouched, until
      // the new one reaches status 'ready' and gets promoted (see
      // publication-authority.js's own header for the full reasoning this
      // mirrors).
      const { data: assetVersion, error: versionErr } = await admin
        .from("audio_visual_asset_versions")
        .insert({ audio_visual_id: videoId, master_r2_key: key, status: "uploaded" })
        .select("id")
        .single();
      if (versionErr) throw versionErr;

      const { error: jobErr } = await admin.from("hls_transcode_jobs").insert({
        job_type: "video",
        asset_version_id: assetVersion.id,
        source_key: key,
        status: "pending",
        queued_by: user.id,
      });
      if (jobErr) throw jobErr;

      console.info(`[admin/audio-visual/upload/complete] master queued videoId=${videoId} assetVersionId=${assetVersion.id}`);
      emitServerEvent("info", "admin_audio_visual_upload_completed", { videoId, assetType, assetVersionId: assetVersion.id });
      return NextResponse.json({ ok: true, assetType, assetVersionId: assetVersion.id });
    }

    return NextResponse.json({ error: "Unknown assetType" }, { status: 400 });
  } catch (err) {
    emitServerEvent("error", "admin_audio_visual_upload_completion_failed", { videoId, assetType }, err);
    return NextResponse.json({ error: "Failed to record upload completion" }, { status: 500 });
  }
}
