/**
 * The only valid rendition values for a job_type='video' hls_transcode_jobs row.
 * Kept as its own module — never merged with audio-renditions.js — so an
 * audio-shaped value can never silently qualify as a video rendition.
 */
export const VIDEO_RENDITIONS = ["2160p", "1080p", "720p", "480p"];

export function isValidVideoRendition(value) {
  return VIDEO_RENDITIONS.includes(value);
}
