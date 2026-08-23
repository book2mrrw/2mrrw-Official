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
});

export const IMAGE_COVER_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const VIDEO_COVER_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";
export const MASTER_AUDIO_ACCEPT = ".wav,.flac,.aiff,.aif,audio/wav,audio/flac,audio/aiff";

export function extensionForFilename(filename) {
  return String(filename || "").split(".").pop()?.toLowerCase() || "";
}
