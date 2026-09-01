/**
 * Phase 17B — stable playback action surface for Page without subscribing to AudioContext state.
 * PlaybackChromeIsland publishes actions; Page reads via usePagePlaybackActions().
 */

/** @type {import("@/context/AudioContext").AudioContextValue | null} */
let playbackActionsBridge = null;

// Deferred play intent: if a card is tapped before PlaybackChromeIsland's useEffect has
// wired the bridge (typically a <50ms window on first load), store the intent and drain it
// the moment the bridge comes up. TTL prevents stale intents from firing unexpectedly.
const INTENT_TTL_MS = 3000;
let _pendingIntent = null; // { fn: (bridge) => void, queuedAt: number } | null

/**
 * @param {Partial<import("@/context/AudioContext").AudioContextValue> | null} actions
 */
export function setPagePlaybackActionsBridge(actions) {
  playbackActionsBridge = actions;
  if (actions && _pendingIntent) {
    const { fn, queuedAt } = _pendingIntent;
    _pendingIntent = null;
    if (Date.now() - queuedAt < INTENT_TTL_MS) {
      fn(actions);
    }
  }
}

export function getPagePlaybackActionsBridge() {
  return playbackActionsBridge;
}

/**
 * Call fn(bridge) immediately if the bridge is live, otherwise queue it for when it comes up.
 * Only one intent is held at a time — a second call before the bridge is live replaces the first.
 * @param {(bridge: NonNullable<typeof playbackActionsBridge>) => void} fn
 */
export function queuePlayIntent(fn) {
  if (playbackActionsBridge) {
    fn(playbackActionsBridge);
    return;
  }
  _pendingIntent = { fn, queuedAt: Date.now() };
}

