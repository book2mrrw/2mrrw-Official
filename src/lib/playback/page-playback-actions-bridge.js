/**
 * Phase 17B — stable playback action surface for Page without subscribing to AudioContext state.
 * PlaybackChromeIsland publishes actions; Page reads via usePagePlaybackActions().
 */

/** @type {import("@/context/AudioContext").AudioContextValue | null} */
let playbackActionsBridge = null;

/** @type {(() => void) | null} */
let dismissNowPlayingBridge = null;

/**
 * @param {Partial<import("@/context/AudioContext").AudioContextValue> | null} actions
 */
export function setPagePlaybackActionsBridge(actions) {
  playbackActionsBridge = actions;
}

export function getPagePlaybackActionsBridge() {
  return playbackActionsBridge;
}

/** @param {(() => void) | null} fn */
export function setDismissNowPlayingBridge(fn) {
  dismissNowPlayingBridge = fn;
}

export function dismissNowPlayingFromBridge() {
  dismissNowPlayingBridge?.();
}
