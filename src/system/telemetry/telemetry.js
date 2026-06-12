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
  buffer.push(safe);
  const level = levelForEvent(safe);
  clientLog(level, safe.type.replace(/\./g, "_"), {
    domain: "telemetry",
    ...safe,
  });
}

function getBuffer() {
  return buffer.peek(500);
}

function flush() {
  const events = buffer.drain();
  if (!events.length) return;
  const urgent = events.filter((e) => {
    const level = levelForEvent(e);
    return level === "error" || level === "warn";
  });
  const info = events.filter((e) => levelForEvent(e) === "info");

  if (urgent.length) {
    import("./posthogAdapter")
      .then(({ flushToPosthog }) => flushToPosthog(urgent))
      .catch(() => {});
  }

  if (info.length && typeof window !== "undefined") {
    const schedule =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : (cb) => setTimeout(cb, 200);
    schedule(() => {
      import("./posthogAdapter")
        .then(({ flushToPosthog }) => flushToPosthog(info))
        .catch(() => {});
    });
  }
}

export const telemetry = { log, getBuffer, flush };
