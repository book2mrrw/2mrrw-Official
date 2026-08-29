/**
 * Physical lifecycle authority for animated cover art.
 *
 * Cover motion is part of the product surface, not expendable decoration.
 * React owns the element and asset identity; this controller performs only the
 * minimum imperative work needed to keep that identity playing. It never
 * observes scrolling or audio playback, never participates in a decoder
 * eviction budget, never pauses, never detaches `src`, and never calls load().
 */
export function createPersistentVisualLifecycle(video) {
  if (!video) throw new Error("persistent_visual_video_required");

  let disposed = false;
  let source = null;
  let playAttemptPending = false;

  const ensurePlaying = () => {
    if (disposed || !source || !video.paused || video.ended || playAttemptPending) return;
    playAttemptPending = true;
    Promise.resolve(video.play())
      .catch(() => {
        // Muted inline video normally autoplays. If the browser temporarily
        // refuses, readiness and foreground events provide safe retry points.
      })
      .finally(() => {
        playAttemptPending = false;
      });
  };

  const revealReadyFrame = () => {
    video.dataset.mediaReady = "true";
    video.style.opacity = "1";
    ensurePlaying();
  };

  const recoverUnexpectedPause = () => {
    queueMicrotask(ensurePlaying);
  };

  const setSource = (nextSource) => {
    const normalized = nextSource ? String(nextSource) : null;
    if (!normalized || normalized === source) return false;
    source = normalized;

    video.dataset.mediaReady = "false";
    video.style.opacity = "0";
    video.preload = "auto";
    video.src = normalized;
    ensurePlaying();
    return true;
  };

  video.addEventListener("loadeddata", revealReadyFrame);
  video.addEventListener("canplay", revealReadyFrame);
  video.addEventListener("pause", recoverUnexpectedPause);

  const onForegroundOpportunity = () => ensurePlaying();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onForegroundOpportunity);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", onForegroundOpportunity);
    window.addEventListener("focus", onForegroundOpportunity);
  }

  return Object.freeze({
    setSource,
    ensurePlaying,
    dispose() {
      if (disposed) return;
      disposed = true;
      video.removeEventListener("loadeddata", revealReadyFrame);
      video.removeEventListener("canplay", revealReadyFrame);
      video.removeEventListener("pause", recoverUnexpectedPause);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onForegroundOpportunity);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", onForegroundOpportunity);
        window.removeEventListener("focus", onForegroundOpportunity);
      }
    },
  });
}
