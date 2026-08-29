/**
 * Dependency-inversion seam between legacy playback commands and Playback
 * Core's Selection authority — mirrors transport-observation-port.js's shape.
 *
 * This module intentionally imports no Core internals. Production wiring
 * installs one authority sink; legacy command services propose named
 * Selection transitions through it. When no sink is installed, proposals fail
 * closed (SELECTION_AUTHORITY_UNAVAILABLE) rather than silently no-opping.
 */

const EMPTY_SELECTION = Object.freeze({
  nowPlaying: null,
  queue: Object.freeze([]),
  queueIndex: -1,
  repeatMode: "off",
  shuffle: false,
  shuffleOrder: null,
  shufflePosition: 0,
  selectionVersion: 0,
  updatedAt: 0,
});

let installed = null;

export function installSelectionAuthoritySink(sink) {
  if (!sink || typeof sink.propose !== "function") {
    throw new TypeError("[SelectionBridge] a complete authority sink is required");
  }
  const installation = Symbol("selection-sink");
  installed = { installation, ...sink };
  return () => {
    if (installed?.installation === installation) installed = null;
  };
}

function unavailable() {
  return { accepted: false, rejectionReason: "SELECTION_AUTHORITY_UNAVAILABLE", snapshot: EMPTY_SELECTION };
}

export function captureSelectionContext(meta = {}) {
  return installed?.captureContext?.(meta) ?? null;
}

export function getCanonicalSelection() {
  return installed?.getSnapshot?.() ?? EMPTY_SELECTION;
}

export function subscribeCanonicalSelection(listener) {
  return installed?.subscribe?.(listener) ?? (() => {});
}

/**
 * @param {string} transitionName - one of the SelectionAuthority method names
 *   (setQueueAndSelect, selectIndex, selectMedia, next, previous, removeItem,
 *   insertItem, reorderQueue, replaceQueue, clearQueue, restoreSelection,
 *   setTraversalPolicy, updateNowPlayingRepresentation, updateQueueRepresentation)
 * @param {Array} args - positional arguments for that method, excluding context
 * @param {object|null} context - a previously captured context, or null to
 *   let the authority capture one synchronously at proposal time
 */
export function proposeSelection(transitionName, args = [], context = null) {
  if (!installed) return unavailable();
  return installed.propose(transitionName, args, context);
}

export function getSelectionAuthorityMetrics() {
  return installed?.getMetrics?.() ?? Object.freeze({ proposals: 0, accepted: 0, rejected: 0 });
}
