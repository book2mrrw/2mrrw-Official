import { buildHLSPrefix } from "@/lib/hls/derive-key";
import { segmentDurationForSourceKey } from "@/lib/hls/playback-quality-policy";

export const HLS_TRANSCODE_PROFILE_VERSION = 3;
export const AUDIO_HLS_BITRATES = ["320k", "160k", "96k"];

/**
 * The database RPC serializes enqueue races and creates an immutable generation
 * prefix. Callers never write queue rows directly.
 */
export async function enqueueHlsTranscodeJob(admin, {
  slug,
  trackSlug = null,
  releaseType = "singles",
  sourceKey,
  priority = 5,
  bitrates = AUDIO_HLS_BITRATES,
  queuedBy = "system",
  force = false,
  targetProfileVersion = HLS_TRANSCODE_PROFILE_VERSION,
}) {
  const baseHlsPrefix = buildHLSPrefix(slug, trackSlug, releaseType);
  const { data, error } = await admin.rpc("hls_enqueue_transcode_job", {
    p_slug: slug,
    p_track_slug: trackSlug,
    p_release_type: releaseType,
    p_source_key: sourceKey,
    p_base_hls_prefix: baseHlsPrefix,
    p_priority: priority,
    p_bitrates: bitrates,
    p_segment_duration_secs: segmentDurationForSourceKey(sourceKey),
    p_queued_by: queuedBy,
    p_target_profile_version: targetProfileVersion,
    p_force: force,
  });
  if (error) throw new Error(`HLS enqueue failed: ${error.message}`);

  const job = Array.isArray(data) ? data[0] : data;
  if (!job?.id || !job?.hls_prefix || !Number.isFinite(Number(job.generation))) {
    throw new Error("HLS enqueue returned an invalid generation contract");
  }
  return job;
}
