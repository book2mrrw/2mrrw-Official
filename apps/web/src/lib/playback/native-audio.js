/**
 * The 2MRRW app's native audio seam. Before the website loads, the app
 * installs window.__2MRRW_NATIVE_AUDIO__ with a factory for a native-backed
 * media element: the engine holds it in place of its <audio>, and the native
 * player (AVPlayer / ExoPlayer) owns decoding, buffering, adaptive bitrate, the
 * lock screen, Dynamic Island, Bluetooth and background playback. The engine's
 * own logic — queue, state, access, analytics — is unchanged.
 *
 * On the website none of this exists: every check below is false there.
 */

const PLATFORM_KEY = "__2MRRW_NATIVE_AUDIO__";

/** The app's native audio platform, or null (always null on the website). */
export function nativeAudioPlatform() {
  return typeof window === "undefined" ? null : window[PLATFORM_KEY] ?? null;
}

/** True for the app's native-backed element, never for an <audio>. */
export function isNativeAudioElement(element) {
  return Boolean(element && element.isNativeAudio === true);
}

/**
 * What native should play after the current song while the web view may be
 * suspended (a locked iPhone): the same order the engine advances through —
 * shuffle's established permutation, repeat, stop-after-each and the sleep
 * timer's "after this song" included.
 */
export function nativeUpcoming({
  queue, queueIndex, repeatMode = "off", shuffle = false, shuffledOrder = null, shufflePosition = 0,
  stopAfterEachTrack = false, sleepAfterCurrentTrack = false,
}) {
  if (repeatMode === "one") return { tracks: [], repeat: "one" };
  if ((stopAfterEachTrack && repeatMode !== "all") || sleepAfterCurrentTrack) return { tracks: [], repeat: "off" };
  if (!Array.isArray(queue) || queueIndex < 0 || queueIndex >= queue.length) return { tracks: [], repeat: "off" };
  let order;
  if (shuffle && queue.length > 1 && Array.isArray(shuffledOrder) && shuffledOrder[shufflePosition] === queueIndex) {
    order = shuffledOrder.slice(shufflePosition + 1);
  } else if (shuffle && queue.length > 1) {
    return { tracks: [], repeat: "off" }; // no established order yet: the engine picks the next song
  } else {
    order = queue.map((_, i) => i).slice(queueIndex + 1);
  }
  return { tracks: order.map((i) => queue[i]).filter(Boolean), repeat: repeatMode === "all" ? "all" : "off" };
}
