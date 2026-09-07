/**
 * The only valid rendition values for a job_type='audio' hls_transcode_jobs row.
 * Kept as its own module — never merged with video-renditions.js — so a
 * video-shaped value can never silently qualify as an audio rendition again.
 *
 * 64k is the data-saver floor for genuinely poor connections (slow-2g/2g).
 * It is the lowest rung that stays safely within AAC-LC's quality-preserving
 * range — going lower on this codec trades stalls for audible warble/metallic
 * artifacts, which is a worse failure mode, not a fix. New transcode jobs
 * queued without an explicit `bitrates` list get all four rungs automatically
 * (see /api/admin/hls/queue); existing manifests keep their original 3-rung
 * bitrate list until explicitly re-queued.
 */
export const AUDIO_RENDITIONS = ["320k", "160k", "96k", "64k"];

export function isValidAudioRendition(value) {
  return AUDIO_RENDITIONS.includes(value);
}
