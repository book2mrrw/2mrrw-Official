/** Pure original-audio key contract shared by encoding and lyric-reference delivery. */
export const MASTER_AUDIO_EXTENSION = /\.(wav|wave|aif|aiff|flac|m4a|mp3)$/i;

export function validateAudioSourceKey(value) {
  const key = String(value || "").replace(/^\/+/, "");
  if (!key || key.includes("..") || key.includes("://") || !MASTER_AUDIO_EXTENSION.test(key) ||
      /(^|\/)(streaming|hls|previews?|waveforms?)(\/|$)/i.test(key)) {
    throw new Error("A full original audio object is required; streaming renditions and previews cannot be encoding sources");
  }
  return key;
}
