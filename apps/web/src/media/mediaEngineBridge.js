/**
 * Imperative bridge for non-React consumers (MediaEngine facade).
 * AudioProvider registers getState + notifies on state sync.
 */

let bridge = null;
const listeners = new Set();

export function registerMediaEngineBridge(next) {
  bridge = next;
}

export function getMediaEngineBridge() {
  return bridge;
}

export function notifyMediaEngineBridge() {
  if (!bridge?.getState) return;
  const snapshot = bridge.getState();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  });
}

export function subscribeMediaEngine(listener) {
  listeners.add(listener);
  if (bridge?.getState) {
    try {
      listener(bridge.getState());
    } catch {
      /* ignore */
    }
  }
  return () => listeners.delete(listener);
}
