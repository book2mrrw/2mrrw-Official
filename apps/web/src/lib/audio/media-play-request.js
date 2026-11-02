/** One bounded physical play request. No retries or source decisions here. */
const operations = new WeakMap();

export function classifyMediaFailure(error, audio) {
  if (error?.name === "NotAllowedError") return "permission";
  if (error?.name === "AbortError") return "cancelled";
  if (error?.name === "TimeoutError") return "timeout";
  if (error?.status === 401 || error?.status === 403) return "authentication";
  if (error?.name === "NotSupportedError" || audio?.error?.code === 4) return "unsupported";
  if (audio?.error?.code === 2 || error?.name === "NetworkError") return "network";
  return "media";
}

export function requestMediaPlay(audio, { signal, isCurrent = () => true, timeoutMs = 12000 } = {}) {
  if (signal?.aborted || !isCurrent()) return Promise.reject(new DOMException("Playback superseded", "AbortError"));
  const operation = {};
  operations.set(audio, operation);
  const source = audio.src;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const ownsSource = () => operations.get(audio) === operation && audio.src === source;
    const stop = () => { if (ownsSource()) audio.pause(); };
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      audio.removeEventListener?.("error", onError);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => { stop(); done(new DOMException("Playback superseded", "AbortError")); };
    const onError = () => done(Object.assign(new Error(audio.error?.message || "Media loading failed"), {
      name: "MediaError", code: audio.error?.code,
    }));
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.addEventListener?.("error", onError, { once: true });
    timer = setTimeout(() => {
      stop();
      done(Object.assign(new Error("Playback startup deadline exceeded"), { name: "TimeoutError" }));
    }, timeoutMs);
    try {
      // No await before play: callers retaining activation can call this leaf
      // directly from the gesture stack. Browser buffering belongs to play().
      Promise.resolve(audio.play()).then(() => {
        if (settled) { stop(); return; }
        if (signal?.aborted || !isCurrent()) { onAbort(); return; }
        done();
      }, done);
    } catch (error) { done(error); }
  });
}
