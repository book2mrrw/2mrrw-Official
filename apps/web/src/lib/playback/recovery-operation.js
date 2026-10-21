import { isSamePlaybackTrack } from "@/lib/music-playback";

/** A recovery borrows the current selection; it never owns a later user intent. */
export function captureRecoveryOperation(refs, { respectPause = true } = {}) {
  const audio = refs.audioRef.current;
  const track = refs.stateRef.current.currentTrack;
  const generation = refs.playRequestIdRef?.current;
  const command = refs.commandRequestIdRef?.current;
  const access = track?.metadata?.access;
  const sameMedia = () => audio === refs.audioRef.current &&
    generation === refs.playRequestIdRef?.current &&
    (track === refs.stateRef.current.currentTrack || isSamePlaybackTrack(track, refs.stateRef.current.currentTrack)) &&
    access?.canStream === refs.stateRef.current.currentTrack?.metadata?.access?.canStream &&
    access?.previewOnly === refs.stateRef.current.currentTrack?.metadata?.access?.previewOnly;
  const sameSelection = () => sameMedia() && command === refs.commandRequestIdRef?.current;
  const userStopped = () => Boolean(refs.userPausedRef?.current || refs.userIntentPausedRef?.current);
  return {
    audio, track,
    isCurrent: () => sameSelection() && (!respectPause || !userStopped()),
    cancelStalePlay: ({ abandoned = false } = {}) => {
      // A pending play promise can settle after a deliberate pause. Never pause
      // a newer selection in order to cancel the old operation.
      if (sameMedia() && (userStopped() || (sameSelection() && abandoned)) && !audio?.paused) audio.pause();
    },
  };
}

/** Confirms media advancement, not physical speaker output or a Bluetooth route. */
export function confirmRecoveryPlayback(audio, context, { isCurrent, timeoutMs = 750 } = {}) {
  const start = audio.currentTime;
  return new Promise((resolve) => {
    let timer;
    let settled = false;
    const events = ["playing", "timeupdate", "canplay", "pause", "ended", "error"];
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      events.forEach(event => audio.removeEventListener(event, check));
      context?.removeEventListener?.("statechange", check);
      resolve(ok);
    };
    const check = () => {
      if (!isCurrent() || audio.ended || audio.error) return finish(false);
      if (!audio.paused && audio.readyState >= 2 &&
          (!context || context.state === "running") && audio.currentTime > start + 0.01) finish(true);
    };
    events.forEach(event => audio.addEventListener(event, check));
    context?.addEventListener?.("statechange", check);
    timer = setTimeout(() => { check(); finish(false); }, timeoutMs);
    check();
  });
}
