/**
 * Storage and encryption for the video lanes — music videos / short films /
 * documentaries (hls_transcode_jobs job_type 'video'), vault videos
 * ('vault_video') and track visuals (track_visual_jobs) — with no credential
 * on the hosts that encode them.
 *
 * A worker proves the job it holds with the lease its lane's claim issued
 * (hls_claim_media_job / claim_track_visual_job). For that job alone, and
 * only while that lease is current, the website signs a short-lived read link
 * for its source, write links under that attempt's own folder, and hands over
 * that one job's content key (the key every viewer's player already receives)
 * — never a storage key or a master secret. A music video also gets the
 * folder details the worker used to read from the database itself.
 */

import { createHmac } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { createR2SignedGetUrl, createR2SignedPutUrl } from "@/lib/storage/r2";
import { deriveHLSKey, deriveHLSIV } from "@/lib/hls/derive-key";
import { deriveAudioVisualHLSKey, deriveAudioVisualHLSIV } from "@/lib/audio-visual/derive-key";
import { audioVisualR2FolderPath } from "@/lib/audio-visual/r2-paths";
import { invalidateManifestCache } from "@/lib/server/hls-manifest-cache";

export const LANES = new Set(["video", "vault_video", "track_visual"]);
export const OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const CONTENT_TYPES = new Set(["video/mp2t", "video/mp4", "application/x-mpegURL"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TTL_SECONDS = 15 * 60;
const MAX_UPLOADS = 500;
const PUBLISHED_WINDOW_MS = 15 * 60 * 1000;

const reply = (status, body) => ({ status, body });
const hex = (buffer) => Buffer.from(buffer).toString("hex");

/** Track visuals: the same derivation the visual key route serves viewers. */
function trackVisualKeys(versionId) {
  const secret = process.env.TRACK_VISUAL_MASTER_SECRET || process.env.HLS_MASTER_SECRET;
  if (!secret) throw new Error("track visual encryption secret is not configured");
  const derive = (purpose) => createHmac("sha256", secret).update(`2mrrw:track-visual:${versionId}:${purpose}`).digest().subarray(0, 16);
  return { key: hex(derive("key")), iv: hex(derive("iv")) };
}

async function one(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * The job this lease holds, as { sourceKey, prefix, encryption, context },
 * or null when the lease is not (or no longer) current.
 */
async function heldJob(db, { lane, jobId, workerId, leaseToken, generation }) {
  if (lane === "track_visual") {
    const job = await one(db.from("track_visual_jobs").select("id, version_id, status, lease_token, worker_id").eq("id", jobId));
    if (!job || job.status !== "processing" || job.lease_token !== leaseToken || job.worker_id !== workerId) return null;
    const version = await one(db.from("track_visual_versions").select("id, track_id, source_key").eq("id", job.version_id));
    if (!version?.source_key) return null;
    return {
      sourceKey: version.source_key,
      prefix: `track-visuals/renditions/${version.track_id}/${version.id}/${leaseToken}/`,
      encryption: trackVisualKeys(version.id),
      context: { version_id: version.id, track_id: version.track_id },
    };
  }

  const job = await one(db.from("hls_transcode_jobs")
    .select("id, job_type, status, worker_id, claim_token, generation, slug, source_key, hls_prefix, asset_version_id")
    .eq("id", jobId));
  if (!job || job.job_type !== lane || job.status !== "processing" || job.worker_id !== workerId
      || job.claim_token !== leaseToken || Number(job.generation) !== Number(generation)) return null;

  if (lane === "vault_video") {
    if (!String(job.hls_prefix || "").startsWith("hls/vault/")) return null;
    const [key, iv] = await Promise.all([deriveHLSKey(job.slug), deriveHLSIV(job.slug)]);
    return { sourceKey: job.source_key, prefix: job.hls_prefix, encryption: { key: hex(key), iv: hex(iv) }, context: { slug: job.slug } };
  }

  const version = await one(db.from("audio_visual_asset_versions").select("id, audio_visual_id").eq("id", job.asset_version_id));
  const video = version && await one(db.from("audio_visuals")
    .select("id, slug, video_type, seriez_id, peek_start_seconds, peek_duration_seconds").eq("id", version.audio_visual_id));
  if (!video) return null;
  const seriez = video.seriez_id ? await one(db.from("audio_visual_seriez").select("slug").eq("id", video.seriez_id)) : null;
  const folder = audioVisualR2FolderPath({
    videoType: video.video_type, slug: video.slug, seriezSlug: seriez?.slug ?? null, episodeSlug: seriez?.slug ? video.slug : null,
  });
  const [key, iv] = await Promise.all([deriveAudioVisualHLSKey(video.id, version.id), deriveAudioVisualHLSIV(video.id, version.id)]);
  return {
    sourceKey: job.source_key,
    // Each attempt's own folder; hls_commit_video_job publishes nothing else.
    prefix: `${folder}renditions/${version.id}/g${job.generation}/`,
    encryption: { key: hex(key), iv: hex(iv) },
    context: {
      audio_visual_id: video.id,
      asset_version_id: version.id,
      peek_start_seconds: video.peek_start_seconds,
      peek_duration_seconds: video.peek_duration_seconds,
    },
  };
}

/** Requested uploads, if every one is a known type under `prefix`; otherwise null. */
function signable(uploads, prefix) {
  if (uploads == null) return [];
  if (!Array.isArray(uploads) || uploads.length > MAX_UPLOADS) return null;
  const seen = new Set();
  for (const item of uploads) {
    const key = String(item?.key ?? "");
    const tail = key.slice(prefix.length);
    if (!key.startsWith(prefix) || !tail || key.length > 1024 || key.includes("..") || tail.includes("//")
        || /[\u0000-\u001f\u007f]/.test(key) || !CONTENT_TYPES.has(item?.content_type) || seen.has(key)) return null;
    seen.add(key);
  }
  return uploads.map((item) => ({ key: String(item.key), contentType: item.content_type }));
}

/**
 * POST /api/hls/lane-transfers. Request: { lane, job_id, worker_id,
 * lease_token, generation (video lanes), uploads?: [{ key, content_type }] }.
 * Returns { status, body }.
 */
export async function laneTransfers(request, { db } = {}) {
  const lane = String(request?.lane ?? "");
  const jobId = String(request?.job_id ?? "");
  const workerId = String(request?.worker_id ?? "");
  const leaseToken = String(request?.lease_token ?? "");
  if (!LANES.has(lane) || !UUID.test(jobId) || !UUID.test(leaseToken) || !workerId.trim()
      || (lane !== "track_visual" && !Number.isInteger(Number(request?.generation)))) {
    return reply(400, { error: "lane, job_id, worker_id, lease_token and generation are required" });
  }

  const client = db ?? getAdminClient();
  const held = await heldJob(client, { lane, jobId, workerId, leaseToken, generation: request?.generation });
  if (!held) return reply(403, { error: "not the current holder of this job" });

  const uploads = signable(request?.uploads, held.prefix);
  if (!uploads) return reply(400, { error: `uploads must be known media types under ${held.prefix}, at most ${MAX_UPLOADS}` });

  const [source, signed] = await Promise.all([
    createR2SignedGetUrl(held.sourceKey, LINK_TTL_SECONDS),
    Promise.all(uploads.map(async ({ key, contentType }) => ({
      key,
      url: await createR2SignedPutUrl(key, contentType, LINK_TTL_SECONDS, { cacheControl: OBJECT_CACHE_CONTROL }),
      content_type: contentType,
    }))),
  ]);
  return reply(200, {
    source: { url: source },
    prefix: held.prefix,
    encryption: held.encryption,
    context: held.context,
    uploads: signed,
    cache_control: OBJECT_CACHE_CONTROL,
  });
}

/**
 * A vault video just published by this worker: refresh the website's manifest
 * cache now rather than after its TTL. Only for a job this worker completed in
 * the last fifteen minutes; a cache refresh is all it can cause.
 */
export async function lanePublished(request, { db, now = Date.now() } = {}) {
  const jobId = String(request?.job_id ?? "");
  const workerId = String(request?.worker_id ?? "");
  if (request?.lane !== "vault_video" || !UUID.test(jobId) || !workerId.trim() || !Number.isInteger(Number(request?.generation))) {
    return reply(400, { error: "lane vault_video, job_id, worker_id and generation are required" });
  }
  const job = await one((db ?? getAdminClient()).from("hls_transcode_jobs")
    .select("job_type, status, worker_id, generation, slug, completed_at").eq("id", jobId));
  const fresh = job?.completed_at && now - Date.parse(job.completed_at) < PUBLISHED_WINDOW_MS;
  if (!job || job.job_type !== "vault_video" || job.status !== "complete" || job.worker_id !== workerId
      || Number(job.generation) !== Number(request.generation) || !fresh) {
    return reply(403, { error: "not a job this worker just published" });
  }
  await invalidateManifestCache(job.slug, null);
  return reply(200, { refreshed: true });
}
