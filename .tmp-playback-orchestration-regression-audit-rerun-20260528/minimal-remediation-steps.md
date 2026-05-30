# Exact Minimal Remediation Steps

1. In `src/context/AudioContext.js`, add a bounded timeout + abort integration to `waitAudioSrcReady()` and return explicit typed errors (`AUDIO_SRC_READY_TIMEOUT`, `AUDIO_SRC_ABORTED`).
2. In `dispatchPlaybackCommand`, add per-command watchdog timeout and queue-release fallback so one hung command cannot block the entire serial chain.
3. Add guarded fast-lane bypass for `STOP` and `PAUSE` when queue is stalled (or make them non-serial emergency commands).
4. Extend state progression with explicit loading state (e.g., `playbackState: "loading"`) before source readiness, then transition deterministically to `playing` or `paused/error`.
5. Promote hidden catches on critical paths to `reportPlaybackDiagnostic(...)` with command/requestId context, especially in source readiness, recovery refresh, and resume flows.
6. Tighten UI sync by improving equality checks in `src/media/useMediaEngine.js` (queue element field diff beyond id/slug for changed metadata/URLs).
7. In recovery bridge (`AudioPhase10Bridge` + `useSessionRecovery`), gate restore seek until queue is set and active track source is available, then dispatch a recover/resume-safe command.
