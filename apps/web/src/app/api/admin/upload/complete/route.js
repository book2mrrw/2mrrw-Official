import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";
import { ADMIN_UPLOAD_CONTRACTS } from "@/lib/media/admin-upload-contract";
import { emitServerEvent } from "@/lib/observability/server-events";
import { enqueueHlsTranscodeJob } from "@/lib/hls/transcode-queue";

export const dynamic = "force-dynamic";

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

export async function POST(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const user = await getAdminSessionUser();
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

  const { releaseId, trackId, key, assetType, releaseType, slug, trackSlug, trackTitle, position, durationSeconds } = body;

  if (!key || !assetType || !releaseId) {
    return NextResponse.json({ error: "releaseId, key, and assetType are required" }, { status: 400 });
  }

  // Verify the file actually exists in R2 before accepting completion
  let exists = false;
  try {
    exists = await headR2ObjectKey(key);
  } catch (err) {
    emitServerEvent("error", "admin_upload_storage_verification_failed",
      { correlationId, releaseId, assetType, objectKey: key }, err);
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
        // Position is the persisted track identity. Track slugs are carried by
        // the upload/HLS payload and must not make completion depend on an
        // optional database column.
        let existingQuery = admin
          .from("tracks")
          .select("id")
          .eq("release_id", releaseId);
        if (position) existingQuery = existingQuery.eq("position", position);
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

      // Upload completion is a new source generation. The currently active HLS
      // rendition remains live until this immutable generation commits.
      let hlsError = null;
      try {
        await enqueueHlsTranscodeJob(admin, {
          slug,
          trackSlug: trackSlug || null,
          releaseType: RELEASE_TYPE_FOLDERS[releaseType] || "singles",
          sourceKey: key,
          queuedBy: user.id,
          force: true,
        });
      } catch (error) {
        hlsError = error;
      }
      if (hlsError) {
        console.warn("[admin/upload/complete] HLS queue error (non-fatal)", hlsError.message);
      }

      console.info(`[admin/upload/complete] audio complete key=${key} trackId=${resolvedTrackId}`);
      // A draft still under construction must never bust the storefront ISR cache —
      // only a release that's already public (or a legacy catalog product, which has
      // no draft state) warrants revalidation on every asset attach.
      const { data: audioRelStatus } = await admin.from("releases").select("status").eq("id", releaseId).maybeSingle();
      if (!audioRelStatus || audioRelStatus.status !== "draft") revalidateStorefront();
      emitServerEvent("info", "admin_upload_completed", { correlationId, releaseId, assetType, trackId: resolvedTrackId, hlsQueued: !hlsError });
      return NextResponse.json({ ok: true, assetType, trackId: resolvedTrackId, hlsQueued: !hlsError });
    }

    if (assetType === "cover") {
      // Try wizard release (releases table) first
      const { data: relRow } = await admin
        .from("releases").select("id, status").eq("id", releaseId).maybeSingle();

      if (relRow) {
        const { error } = await admin
          .from("releases").update({ cover_art_r2_key: key }).eq("id", releaseId);
        if (error) throw error;
      } else {
        // Catalog product (products table) — update image_path + metadata
        const { data: product, error: prodErr } = await admin
          .from("products").select("metadata").eq("id", releaseId).maybeSingle();
        if (prodErr || !product) {
          return NextResponse.json({ error: "Release not found for cover art update" }, { status: 404 });
        }
        const coverFolder = key.split("/").slice(0, -1).join("/") + "/";
        const { error: updErr } = await admin.from("products").update({
          image_path: coverFolder,
          metadata:   { ...(product.metadata || {}), cover_art_r2_key: key },
        }).eq("id", releaseId);
        if (updErr) throw updErr;
      }

      console.info(`[admin/upload/complete] cover complete key=${key} releaseId=${releaseId}`);
      if (!relRow || relRow.status !== "draft") revalidateStorefront();
      emitServerEvent("info", "admin_upload_completed", { correlationId, releaseId, assetType });
      return NextResponse.json({ ok: true, assetType });
    }

    if (assetType === "cover-video") {
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > ADMIN_UPLOAD_CONTRACTS["cover-video"].maxDurationSeconds + 0.5) {
        return NextResponse.json({ error: "Cover video must be no longer than 7 minutes" }, { status: 400 });
      }
      const { data: rel } = await admin.from("releases").select("id, status, metadata").eq("id", releaseId).maybeSingle();
      if (rel) {
        const meta = (rel.metadata && typeof rel.metadata === "object") ? rel.metadata : {};
        const { error } = await admin.from("releases")
          .update({ metadata: { ...meta, animated_cover_r2_key: key } }).eq("id", releaseId);
        if (error) throw error;
      } else {
        const { data: product, error: productError } = await admin.from("products")
          .select("metadata").eq("id", releaseId).single();
        if (productError) throw productError;
        const { error } = await admin.from("products").update({
          metadata: { ...(product.metadata || {}), animated_cover_r2_key: key },
          video_path: key.split("/").slice(0, -1).join("/") + "/",
        }).eq("id", releaseId);
        if (error) throw error;
      }

      if (!rel || rel.status !== "draft") revalidateStorefront();
      emitServerEvent("info", "admin_upload_completed", { correlationId, releaseId, assetType });
      return NextResponse.json({ ok: true, assetType });
    }

    if (assetType === "preview") {
      const { data: rel } = await admin.from("releases").select("status, metadata").eq("id", releaseId).single();
      const meta = (rel?.metadata && typeof rel.metadata === "object") ? rel.metadata : {};
      const { error } = await admin
        .from("releases")
        .update({ metadata: { ...meta, preview_r2_key: key } })
        .eq("id", releaseId);
      if (error) throw error;

      if (!rel || rel.status !== "draft") revalidateStorefront();
      emitServerEvent("info", "admin_upload_completed", { correlationId, releaseId, assetType });
      return NextResponse.json({ ok: true, assetType });
    }

    return NextResponse.json({ error: "Unknown assetType" }, { status: 400 });
  } catch (err) {
    emitServerEvent("error", "admin_upload_completion_failed",
      { correlationId, releaseId, assetType }, err);
    return NextResponse.json({ error: "Failed to record upload completion" }, { status: 500 });
  }
}
