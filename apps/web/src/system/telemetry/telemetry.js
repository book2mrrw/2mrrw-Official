import { clientLog } from "@/lib/observability/client-log";
import * as buffer from "./buffer";
import { shouldLogEvent, sanitizeTelemetryPayload } from "./filters";

/** @param {import('./events.js').TelemetryEvent} event */
function levelForEvent(event) {
  const t = event.type;
  if (t.endsWith(".failed") || t.endsWith(".caught") || t.endsWith(".expired")) return "error";
  if (t.endsWith(".stalled") || t.endsWith(".desync") || t.endsWith(".spike") || t === "preload.budget.exceeded")
    return "warn";
  return "info";
}

/** @param {import('./events.js').TelemetryEvent} event */
function log(event) {
  if (!event?.type || !shouldLogEvent(event)) return;
  const safe = sanitizeTelemetryPayload(event);
  const level = levelForEvent(safe);
  clientLog(level, safe.type.replace(/\./g, "_"), {
    domain: "telemetry",
    ...safe,
  });
  if (level === "error" || level === "warn") {
    // Urgent events go to PostHog immediately — skip the buffer so flush() doesn't double-send.
    import("./posthogAdapter")
      .then(({ flushToPosthog }) => flushToPosthog([safe]))
      .catch(() => {});
  } else {
    // Non-urgent events accumulate in the ring buffer for batch flush.
    buffer.push(safe);
  }
}

function getBuffer() {
  return buffer.peek(500);
}

function flush() {
  // Buffer only contains info-level events — urgent events are sent immediately in log().
  const events = buffer.drain();
  if (!events.length || typeof window === "undefined") return;
  const schedule =
    typeof requestIdleCallback === "function"
      ? requestIdleCallback
      : (cb) => setTimeout(cb, 200);
  schedule(() => {
    import("./posthogAdapter")
      .then(({ flushToPosthog }) => flushToPosthog(events))
      .catch(() => {});
  });
}

export const telemetry = { log, getBuffer, flush };
