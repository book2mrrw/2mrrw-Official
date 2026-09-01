const recentKeys = new Map();
const DEDUPE_MS = 1000;

/**
 * @param {import('./events.js').TelemetryEvent} event
 * @returns {boolean}
 */
export function shouldLogEvent(event) {
  if (!event?.type) return false;

  if (event.type === "render.spike" && (event.duration ?? 0) <= 16) return false;
  if (event.type === "interaction.slow" && (event.duration ?? 0) <= 100) return false;

  const contextId =
    event.modalId ||
    event.trackId ||
    event.src ||
    event.endpoint ||
    event.component ||
    event.mark ||
    event.assetId ||
    "";

  const dedupeKey = `${event.type}:${contextId}`;
  const now = Date.now();
  const last = recentKeys.get(dedupeKey);
  if (last && now - last < DEDUPE_MS) return false;
  recentKeys.set(dedupeKey, now);

  return true;
}

/** Strip signed URL query params from any URL field. */
export function sanitizeTelemetryPayload(event) {
  const out = { ...event };
  for (const key of Object.keys(out)) {
    const val = out[key];
    if (typeof val === "string" && (val.startsWith("http") || val.includes("?"))) {
      try {
        const u = new URL(val, "http://localhost");
        u.search = "";
        out[key] = u.pathname + (u.hash || "");
      } catch {
        out[key] = val.split("?")[0];
      }
    }
  }
  return out;
}
