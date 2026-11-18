/**
 * iOS plays HLS through ManagedMediaSource, which tells the page to stop
 * buffering ("endstreaming") whenever it judges enough is buffered, and
 * hls.js then pauses buffering until "startstreaming". After a seek outside
 * the buffer WebKit does not reliably send "startstreaming" (readyState still
 * reads 4), so playback froze at the scrub point and Play after a paused scrub
 * never started. A seek or stall at a position that is not buffered always
 * needs data, so this resumes buffering there; the platform may pause it again
 * once enough is buffered.
 *
 * Attach before hls.attachMedia so it runs ahead of hls.js's own seeking
 * handler, which then loads the fragment at the new position. Returns the
 * detach function.
 */
export function attachBufferingGuard(hls, media) {
  // HLSEngine takes any media-like object and optional-calls the element
  // throughout; one without events has no seek or stall to guard.
  if (typeof media?.addEventListener !== "function") return () => {};
  const resumeIfUnbuffered = () => {
    if (hls.bufferingEnabled !== false) return;
    const time = media.currentTime;
    const ranges = media.buffered;
    for (let i = 0; i < ranges.length; i += 1) {
      if (time >= ranges.start(i) - 0.1 && time < ranges.end(i) - 0.5) return;
    }
    hls.resumeBuffering();
  };
  media.addEventListener("seeking", resumeIfUnbuffered);
  media.addEventListener("waiting", resumeIfUnbuffered);
  return () => {
    media.removeEventListener("seeking", resumeIfUnbuffered);
    media.removeEventListener("waiting", resumeIfUnbuffered);
  };
}
