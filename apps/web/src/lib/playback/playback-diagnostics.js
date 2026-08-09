import { isStateChurnLogEnabled, logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";

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
  if (isStateChurnLogEnabled()) {
    logPlaybackResilience("diagnostic", {
      source: "reportPlaybackDiagnostic",
      code: payload.code,
      level,
      command: payload.command,
      trackSlug: payload.trackSlug,
      errorMessage: payload.errorMessage,
      errorCode: payload.errorCode,
      errorStatus: payload.errorStatus,
      ...context,
    });
  }
  const writer = level === "warn" ? console.warn : console.error;
  writer("[playback-diagnostic]", payload);

  // Route error-level events to the remote telemetry sink so production issues
  // are observable without requiring a browser console session. Fire-and-forget:
  // a missing or slow telemetry module never blocks playback.
  if (level === "error") {
    import("@/system/telemetry")
      .then(({ telemetry }) => {
        telemetry.log({
          type: "playback.diagnostic",
          code: payload.code,
          command: payload.command,
          trackSlug: payload.trackSlug,
          errorCode: payload.errorCode,
          errorStatus: payload.errorStatus,
          at: payload.at,
          context: "playback_pipeline",
        });
      })
      .catch(() => {});
  }
}
