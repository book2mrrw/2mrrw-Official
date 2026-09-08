export function bufferedAhead(audio) {
  try {
    const t = audio.currentTime;
    for (let i = 0; i < audio.buffered.length; i++) {
      // A later disconnected range is not playable runway.
      if (audio.buffered.start(i) <= t && audio.buffered.end(i) > t) {
        return audio.buffered.end(i) - t;
      }
    }
  } catch {}
  return 0;
}

export function canPreloadAudio(audio, { buffering = false, recentStallAt = 0 } = {}) {
  const connection = globalThis.navigator?.connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType)) return false;
  if (!audio || audio.paused || buffering || (recentStallAt > 0 && Date.now() - recentStallAt < 15000)) return false;
  const remaining = audio.duration - audio.currentTime;
  return bufferedAhead(audio) >= Math.min(15, Number.isFinite(remaining) && remaining > 0 ? remaining : 15);
}

/** Extra startup runway on weak links; hidden pages hand buffering to play(). */
export function waitForPlaybackBuffer(audio, { signal, document: doc = globalThis.document } = {}) {
  const weak = ["slow-2g", "2g", "3g"].includes(globalThis.navigator?.connection?.effectiveType);
  const target = weak ? 6 : 3;
  const ready = () => {
    const remaining = audio.duration - audio.currentTime;
    return audio.readyState >= 3 && bufferedAhead(audio) >= Math.min(target,
      Number.isFinite(remaining) && remaining > 0 ? remaining : target);
  };
  if (signal?.aborted || doc?.visibilityState === "hidden" || ready()) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    let poll;
    const done = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const event of ["canplay", "canplaythrough", "progress"]) audio.removeEventListener(event, check);
      doc?.removeEventListener("visibilitychange", check);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const check = () => {
      if (signal?.aborted || doc?.visibilityState === "hidden" || ready()) done();
    };
    for (const event of ["canplay", "canplaythrough", "progress"]) audio.addEventListener(event, check);
    doc?.addEventListener("visibilitychange", check);
    signal?.addEventListener("abort", done, { once: true });
    poll = setInterval(check, 100);
    timer = setTimeout(done, weak ? 10000 : 6000);
    check();
  });
}
