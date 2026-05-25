/**
 * Dev-only Performance API helpers. No-op in production.
 */

/** @type {Record<string, string>} */
export const MARKS = {
  MODAL_OPEN_START: "2mrrw:modal-open-start",
  MODAL_OPEN_END: "2mrrw:modal-open-end",
  IMMERSIVE_RENDER_START: "2mrrw:immersive-render-start",
  IMMERSIVE_RENDER_END: "2mrrw:immersive-render-end",
  ARTWORK_DECODE_START: "2mrrw:artwork-decode-start",
  ARTWORK_DECODE_END: "2mrrw:artwork-decode-end",
  AUDIO_START_LATENCY_START: "2mrrw:audio-start-latency-start",
  AUDIO_START_LATENCY_END: "2mrrw:audio-start-latency-end",
  TRANSITION_START: "2mrrw:transition-start",
  TRANSITION_END: "2mrrw:transition-end",
  ROUTE_NAV_START: "2mrrw:route-nav-start",
  ROUTE_NAV_END: "2mrrw:route-nav-end",
  QUEUE_UPDATE_START: "2mrrw:queue-update-start",
  QUEUE_UPDATE_END: "2mrrw:queue-update-end",
  HYDRATION_START: "2mrrw:hydration-start",
  HYDRATION_END: "2mrrw:hydration-end",
  GESTURE_START: "2mrrw:gesture-start",
  GESTURE_RESPONSE: "2mrrw:gesture-response",
};

function canMark() {
  return (
    process.env.NODE_ENV === "development" &&
    typeof performance !== "undefined" &&
    typeof performance.mark === "function"
  );
}

/** @param {string} name */
export function perfMark(name) {
  if (!canMark()) return;
  try {
    performance.mark(name);
  } catch {
    /* ignore invalid mark names */
  }
}

/**
 * @param {string} measureName
 * @param {string} startMark
 * @param {string} [endMark]
 */
export function perfMeasure(measureName, startMark, endMark) {
  if (!canMark() || typeof performance.measure !== "function") return;
  try {
    performance.measure(measureName, startMark, endMark);
    const entries = performance.getEntriesByName(measureName, "measure");
    const last = entries[entries.length - 1];
    if (last) {
      console.debug(`[perf] ${measureName}: ${last.duration.toFixed(1)}ms`);
    }
    performance.clearMeasures(measureName);
    performance.clearMarks(startMark);
    if (endMark) performance.clearMarks(endMark);
  } catch {
    /* measure may fail if marks missing */
  }
}

/** Clear all marks/measures with a given prefix (dev cleanup). */
export function perfClear(prefix) {
  if (!canMark()) return;
  for (const entry of performance.getEntriesByType("mark")) {
    if (entry.name.startsWith(prefix)) performance.clearMarks(entry.name);
  }
  for (const entry of performance.getEntriesByType("measure")) {
    if (entry.name.startsWith(prefix)) performance.clearMeasures(entry.name);
  }
}
