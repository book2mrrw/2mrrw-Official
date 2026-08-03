let activeFocus = "music";
let snapshot = null;

function requestFocus(focus, playbackSnapshot) {
  activeFocus = focus || "music";
  snapshot = playbackSnapshot ?? null;
  return { activeFocus, snapshot };
}

function releaseFocus() {
  const released = { activeFocus, snapshot };
  activeFocus = "music";
  snapshot = null;
  return released;
}

function getActiveFocus() {
  return activeFocus;
}

function getSnapshot() {
  return snapshot;
}

function clearSnapshot() {
  snapshot = null;
}

export const focusController = {
  requestFocus,
  releaseFocus,
  getActiveFocus,
  getSnapshot,
  clearSnapshot,
};
