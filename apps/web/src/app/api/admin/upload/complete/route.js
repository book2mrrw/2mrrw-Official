import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

function revalidateStorefront() {
  try {
    revalidatePath("/");
    revalidatePath("/song/[slug]", "page");
    revalidatePath("/feature/[slug]", "page");
    revalidatePath("/album/[slug]", "page");
  } catch {}
}

export const dynamic = "force-dynamic";

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

function buildHLSPrefix(releaseType, slug, trackSlug) {
  const folder = RELEASE_TYPE_FOLDERS[releaseType] || "singles";
  if (trackSlug) return `hls/${folder}/${slug}/${trackSlug}/`;
  return `hls/${folder}/${slug}/`;
}

export async function POST(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.upload.complete",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { releaseId, trackId, key, assetType, releaseType, slug, trackSlug, trackTitle, position } = body;

  if (!key || !assetType || !releaseId) {
    return NextResponse.json({ error: "releaseId, key, and assetType are required" }, { status: 400 });
  }

  // Verify the file actually exists in R2 before accepting completion
  let exists = false;
  try {
    exists = await headR2ObjectKey(key);
  } catch (err) {
    console.error("[admin/upload/complete] HeadObject error", err?.message);
    return NextResponse.json({ error: "R2 verification failed" }, { status: 502 });
  }

  if (!exists) {
    return NextResponse.json({ error: "File not found in R2 — upload may have failed" }, { status: 422 });
  }

  const admin = getAdminClient();

  try {
    if (assetType === "audio") {
      // Upsert or create the tracks row for this release
      const trackPayload = {
        audio_r2_key: key,
        master_r2_key: key,
        upload_status: "ready",
        release_id: releaseId,
      };

      let resolvedTrackId = trackId;

      if (trackId) {
        // Update existing track row
        const { error } = await admin
          .from("tracks")
          .update({ ...trackPayload, upload_status: "ready" })
          .eq("id", trackId);
        if (error) throw error;
      } else {
        // For multi-track: find by release_id + slug; for single: find by release_id only
        let existingQuery = admin
          .from("tracks")
          .select("id")
          .eq("release_id", releaseId);
        if (trackSlug) existingQuery = existingQuery.eq("slug", trackSlug);
        const { data: existing } = await existingQuery.maybeSingle();

        if (existing?.id) {
          resolvedTrackId = existing.id;
          const { error } = await admin
            .from("tracks")
            .update({
              ...trackPayload,
              upload_status: "ready",
              ...(trackTitle ? { title: trackTitle } : {}),
              ...(position ? { position } : {}),
            })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { data: created, error } = await admin
            .from("tracks")
            .insert({
              ...trackPayload,
              release_id: releaseId,
              slug: trackSlug || slug || `track-${releaseId}`,
              title: trackTitle || "",
              position: position || 1,
              upload_status: "ready",
            })
            .select("id")
            .single();
          if (error) throw error;
          resolvedTrackId = created.id;
        }
      }

      // Queue HLS transcode job (check-then-insert to handle COALESCE-based unique index)
      const hlsPrefix = buildHLSPrefix(releaseType, slug, trackSlug);
      const jobSlug = trackSlug || slug;
      const { data: existingJob } = await admin
        .from("hls_transcode_jobs")
        .select("id, status")
        .eq("slug", jobSlug)
        .is(trackSlug ? "track_slug" : "track_slug", trackSlug || null)
        .maybeSingle();

      let hlsError = null;
      if (existingJob) {
        const { error } = await admin
          .from("hls_transcode_jobs")
          .update({ source_key: key, hls_prefix: hlsPrefix, status: "pending", attempt_count: 0, queued_by: user.id })
          .eq("id", existingJob.id);
        hlsError = error;
      } else {
        const { error } = await admin
          .from("hls_transcode_jobs")
          .insert({
            slug: jobSlug,
            track_slug: trackSlug || null,
            release_type: RELEASE_TYPE_FOLDERS[releaseType] || "singles",
            source_key: key,
            hls_prefix: hlsPrefix,
            status: "pending",
            queued_by: user.id,
            attempt_count: 0,
          });
        hlsError = error;
      }
      if (hlsError) {
        console.warn("[admin/upload/complete] HLS queue error (non-fatal)", hlsError.message);
      }

      console.info(`[admin/upload/complete] audio complete key=${key} trackId=${resolvedTrackId}`);
      return NextResponse.json({ ok: true, assetType, trackId: resolvedTrackId, hlsQueued: !hlsError });
    }

    if (assetType === "cover") {
      const { error } = await admin
        .from("releases")
        .update({ cover_art_r2_key: key })
        .eq("id", releaseId);
      if (error) throw error;

      console.info(`[admin/upload/complete] cover complete key=${key} releaseId=${releaseId}`);
      revalidateStorefront();
      return NextResponse.json({ ok: true, assetType });
    }

    if (assetType === "cover-mp4") {
      // Store animated cover R2 key in releases metadata
      const { data: rel } = await admin.from("releases").select("metadata").eq("id", releaseId).single();
      const meta = (rel?.metadata && typeof rel.metadata === "object") ? rel.metadata : {};
      const { error } = await admin
        .from("releases")
        .update({ metadata: { ...meta, animated_cover_r2_key: key } })
        .eq("id", releaseId);
      if (error) throw error;

      revalidateStorefront();
      return NextResponse.json({ ok: true, assetType });
    }

    if (assetType === "preview") {
      const { data: rel } = await admin.from("releases").select("metadata").eq("id", releaseId).single();
      const meta = (rel?.metadata && typeof rel.metadata === "object") ? rel.metadata : {};
      const { error } = await admin
        .from("releases")
        .update({ metadata: { ...meta, preview_r2_key: key } })
        .eq("id", releaseId);
      if (error) throw error;

      return NextResponse.json({ ok: true, assetType });
    }

    return NextResponse.json({ error: "Unknown assetType" }, { status: 400 });
  } catch (err) {
    console.error("[admin/upload/complete] DB error", err?.message);
    return NextResponse.json({ error: "Failed to record upload completion" }, { status: 500 });
  }
}
