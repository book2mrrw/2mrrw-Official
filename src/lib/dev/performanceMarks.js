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
  /** Playback latency pipeline (dev audit) */
  PLAYBACK_TAP: "2mrrw:playback-tap",
  PLAYBACK_REQUEST: "2mrrw:playback-request",
  PLAYBACK_RESOLVER_START: "2mrrw:playback-resolver-start",
  PLAYBACK_RESOLVER_END: "2mrrw:playback-resolver-end",
  PLAYBACK_SIGNED_URL: "2mrrw:playback-signed-url",
  PLAYBACK_SRC_ASSIGN: "2mrrw:playback-src-assign",
  PLAYBACK_FIRST_BYTE: "2mrrw:playback-first-byte",
  PLAYBACK_CANPLAY: "2mrrw:playback-canplay",
  PLAYBACK_AUDIBLE: "2mrrw:playback-audible",
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

const PLAYBACK_STAGE_MEASURES = [
  ["playback-tap-to-request", MARKS.PLAYBACK_TAP, MARKS.PLAYBACK_REQUEST],
  ["playback-request-to-resolver", MARKS.PLAYBACK_REQUEST, MARKS.PLAYBACK_RESOLVER_START],
  ["playback-resolver", MARKS.PLAYBACK_RESOLVER_START, MARKS.PLAYBACK_RESOLVER_END],
  ["playback-signed-url", MARKS.PLAYBACK_RESOLVER_END, MARKS.PLAYBACK_SIGNED_URL],
  ["playback-signed-url-to-src", MARKS.PLAYBACK_SIGNED_URL, MARKS.PLAYBACK_SRC_ASSIGN],
  ["playback-src-to-first-byte", MARKS.PLAYBACK_SRC_ASSIGN, MARKS.PLAYBACK_FIRST_BYTE],
  ["playback-first-byte-to-canplay", MARKS.PLAYBACK_FIRST_BYTE, MARKS.PLAYBACK_CANPLAY],
  ["playback-canplay-to-audible", MARKS.PLAYBACK_CANPLAY, MARKS.PLAYBACK_AUDIBLE],
  ["playback-tap-to-audible", MARKS.PLAYBACK_TAP, MARKS.PLAYBACK_AUDIBLE],
  ["audio-start-latency", MARKS.AUDIO_START_LATENCY_START, MARKS.AUDIO_START_LATENCY_END],
];

/** Dev-only: compute playback stage durations from Performance marks. */
export function dumpPlaybackTiming() {
  if (!canMark()) return {};
  /** @type {Record<string, number | null>} */
  const out = {};
  for (const [name, start, end] of PLAYBACK_STAGE_MEASURES) {
    try {
      performance.measure(name, start, end);
      const entries = performance.getEntriesByName(name, "measure");
      const last = entries[entries.length - 1];
      out[name] = last ? Math.round(last.duration * 10) / 10 : null;
      performance.clearMeasures(name);
    } catch {
      out[name] = null;
    }
  }
  console.table(out);
  if (typeof window !== "undefined") {
    window.__2mrrwLastPlaybackTiming = out;
    window.dumpPlaybackTiming = dumpPlaybackTiming;
  }
  return out;
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
