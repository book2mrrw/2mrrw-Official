/** Canonical upload rules shared by browser UI and server authorization. */
export const ADMIN_UPLOAD_CONTRACTS = Object.freeze({
  audio: {
    maxBytes: 2_000_000_000,
    expiresIn: 900,
    extensions: { wav: "audio/wav", wave: "audio/wav", flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff" },
  },
  cover: {
    maxBytes: 20_000_000,
    expiresIn: 600,
    extensions: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
  },
  "cover-video": {
    maxBytes: 500_000_000,
    expiresIn: 900,
    maxDurationSeconds: 420,
    extensions: { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" },
  },
  preview: {
    maxBytes: 50_000_000,
    expiresIn: 600,
    extensions: { mp3: "audio/mpeg", wav: "audio/wav" },
  },
  // Audio Visualz motion/animated cover art — deliberately the same shape as
  // "cover-video" (mp4/mov/webm, same duration cap) but a fully separate
  // contract entry with its own isolated R2 prefix, consumed only by the
  // Audio Visualz upload path (never src/app/api/admin/upload/*, which is
  // release/track-shaped and must never be touched for this feature).
  "av-cover-video": {
    maxBytes: 500_000_000,
    expiresIn: 900,
    maxDurationSeconds: 420,
    extensions: { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" },
  },
  // Audio Visualz static poster — same shape as "cover", own isolated entry.
  "av-cover": {
    maxBytes: 20_000_000,
    expiresIn: 600,
    extensions: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
  },
  // Audio Visualz master content file — a single presigned PUT, capped at
  // 5GB (R2's own documented single-PUT object limit; a genuinely larger
  // 4K/HDR master would need multipart upload, deliberately not built here
  // — flagged as a known gap, not silently assumed to work for every file
  // size). mkv added alongside mp4/mov since HDR masters commonly arrive in
  // Matroska containers.
  "av-master": {
    maxBytes: 5_000_000_000,
    expiresIn: 3600,
    extensions: { mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska" },
  },
});

export const IMAGE_COVER_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const VIDEO_COVER_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";
export const MASTER_AUDIO_ACCEPT = ".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff";
export const AV_MASTER_ACCEPT = "video/mp4,video/quicktime,video/x-matroska,.mp4,.mov,.mkv";

export function extensionForFilename(filename) {
  return String(filename || "").split(".").pop()?.toLowerCase() || "";
}
