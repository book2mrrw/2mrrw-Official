/** Shared decoder policy. Native HLS takes precedence over MSE capability.
 * Reuse the persistent playback element for detection; never create a probe player.
 */
export function supportsNativeHls(audio) {
  return Boolean(audio?.canPlayType?.("application/vnd.apple.mpegurl") ||
    audio?.canPlayType?.("application/x-mpegURL"));
}

export function selectHlsTransport(audio, Hls) {
  if (supportsNativeHls(audio)) return "native-hls";
  if (Hls?.isSupported()) return "mse-hls";
  return null;
}
