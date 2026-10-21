import { captureRecoveryOperation } from "./recovery-operation";

/** Coalesce route hints. A hint never proves which speaker is actually audible. */
export function createOutputRouteRecovery({ refs, resume, patchState }) {
  let pending = null;
  let disposed = false;
  let cooldownUntil = 0;
  const hasIntent = () => {
    const state = refs.stateRef.current;
    return state.isPlaying || state.osInterrupted || refs.playbackIntentBeforeHideRef.current;
  };
  const request = (reason = "output_change") => {
    if (disposed || pending || Date.now() < cooldownUntil || !hasIntent()) return;
    const operation = captureRecoveryOperation(refs);
    const { audio, isCurrent } = operation;
    if (!audio || audio.ended || !isCurrent()) return;
    // The command that is resolving/loading this source already owns startup.
    if (refs.isRecoveringRef.current || refs.recoveryVerificationRef?.current ||
        ["loading", "loading_stream"].includes(refs.stateRef.current.playbackState) ||
        ["loading_stream", "retrying_stream"].includes(refs.stateRef.current.playbackNetworkState)) return;
    const job = { timer: null, attempts: 0 };
    pending = job;
    const run = async () => {
      if (disposed || pending !== job || !isCurrent() || !hasIntent() || audio.ended) {
        if (pending === job) pending = null;
        return;
      }
      job.attempts++;
      let ok = false;
      try { ok = await resume(reason); } catch { /* bounded failure below */ }
      if (disposed || pending !== job || !isCurrent()) {
        if (pending === job) pending = null;
        return;
      }
      if (ok && !audio.paused && !audio.ended &&
          (!refs.audioCtxRef.current || refs.audioCtxRef.current.state === "running")) {
        pending = null;
        patchState({ isPlaying: true, playbackState: "playing", isBuffering: false,
          playbackNetworkState: "playing", osInterrupted: false, error: null });
      } else if (job.attempts < 3) {
        job.timer = setTimeout(run, job.attempts === 1 ? 250 : 750);
      } else {
        pending = null;
        cooldownUntil = Date.now() + 3000;
        patchState({ isPlaying: false, playbackState: "paused", isBuffering: false,
          playbackNetworkState: "error_stream", streamRetryable: true,
          error: "Audio output interrupted — tap play to continue." });
      }
    };
    // Allow negotiation to begin; retries tolerate later readiness. No reloads,
    // seeks, source replacements, queue writes or output-device permission prompts.
    job.timer = setTimeout(run, 150);
  };
  return {
    request,
    dispose() {
      disposed = true;
      if (pending) clearTimeout(pending.timer);
      pending = null;
    },
  };
}
