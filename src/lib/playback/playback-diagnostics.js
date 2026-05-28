export function reportPlaybackDiagnostic({
  level = "error",
  code,
  command,
  requestId = null,
  state = null,
  error = null,
  context = {},
}) {
  const payload = {
    code: code || "PLAYBACK_DIAGNOSTIC",
    command: command || "UNKNOWN",
    requestId,
    trackId: state?.currentTrackId || state?.currentTrack?.id || null,
    trackSlug: state?.currentTrack?.slug || null,
    playbackState: state?.playbackState || null,
    isPlaying: Boolean(state?.isPlaying),
    errorMessage: error?.message || null,
    errorCode: error?.code || null,
    errorStatus: error?.status || null,
    ...context,
    at: new Date().toISOString(),
  };
  const writer = level === "warn" ? console.warn : console.error;
  writer("[playback-diagnostic]", payload);
}
