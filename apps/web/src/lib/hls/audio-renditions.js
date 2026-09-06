/**
 * The only valid rendition values for a job_type='audio' hls_transcode_jobs row.
 * Kept as its own module — never merged with video-renditions.js — so a
 * video-shaped value can never silently qualify as an audio rendition again.
 */
export const AUDIO_RENDITIONS = ["320k", "160k", "96k"];

export function isValidAudioRendition(value) {
  return AUDIO_RENDITIONS.includes(value);
}
