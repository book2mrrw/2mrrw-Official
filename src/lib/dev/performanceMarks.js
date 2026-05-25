/**
 * Dev-only Performance API helpers. No-op in production.
 */

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
