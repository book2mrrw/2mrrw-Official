import { AUDIO_RENDITIONS } from "./audio-renditions.js";
import { buildHLSPrefix } from "./derive-key.js";
import { resolveAudioSource } from "./audio-source.js";

export class AudioJobConflict extends Error {
  constructor(message = "Audio encoding is already in progress; retry after it finishes") {
    super(message); this.status = 409;
  }
}

/** Never cancels a lease or deletes published media. DB generation triggers own versioning. */
export async function submitAudioJob({ admin, slug, trackSlug = null, releaseType,
  sourceKey = null, queuedBy = null, priority = 5, reuseComplete = false }) {
  if (releaseType === "eps") releaseType = "mixtapes-and-eps";
  if (!/^[a-z0-9_-]+$/.test(slug || "") || (trackSlug && !/^[a-z0-9_-]+$/.test(trackSlug)) ||
      !["singles", "features", "albums", "mixtapes-and-eps"].includes(releaseType)) throw new Error("Invalid audio identity");
  const source = await resolveAudioSource(admin, { slug, trackSlug, releaseType, sourceKey });
  let query = admin.from("hls_transcode_jobs").select("id, status, source_key, bitrates, hls_prefix, updated_at, generation")
    .eq("job_type", "audio").eq("slug", slug);
  query = trackSlug ? query.eq("track_slug", trackSlug) : query.is("track_slug", null);
  const { data: existing, error } = await query.maybeSingle();
  if (error) throw error;
  if (reuseComplete && existing?.status === "complete" && existing.source_key === source &&
      AUDIO_RENDITIONS.every(b => existing.bitrates?.includes(b))) return { ...existing, reused: true };
  if (existing && ["pending", "processing"].includes(existing.status)) {
    if (existing.source_key === source && AUDIO_RENDITIONS.every(b => existing.bitrates?.includes(b))) {
      return { ...existing, reused: true };
    }
    throw new AudioJobConflict();
  }
  const payload = { source_key: source, hls_prefix: buildHLSPrefix(slug, trackSlug, releaseType),
    release_type: releaseType, job_type: "audio", status: "pending", priority,
    bitrates: [...AUDIO_RENDITIONS], segment_duration_secs: 6, queued_by: queuedBy,
    attempt_count: 0, error_message: null, failure_category: null,
    worker_id: null, heartbeat_at: null, started_at: null, completed_at: null };
  let mutation = admin.from("hls_transcode_jobs");
  if (existing) {
    mutation = mutation.update(payload).eq("id", existing.id).eq("status", existing.status)
      .eq("generation", existing.generation).eq("updated_at", existing.updated_at);
  } else mutation = mutation.insert({ slug, track_slug: trackSlug, ...payload });
  const result = await mutation.select("id, status, hls_prefix").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data)) throw new AudioJobConflict();
  if (result.error) throw result.error;
  return result.data;
}
