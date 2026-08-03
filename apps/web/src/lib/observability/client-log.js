const PROD_SAMPLE_RATE = 0.02;

const LEVELS = new Set(["debug", "info", "warn", "error"]);

/**
 * Structured client logging. Verbose in development; sampled or silent in production.
 *
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} event - Stable event name (snake_case)
 * @param {Record<string, unknown>} [data]
 */
export function clientLog(level, event, data = {}) {
  const lvl = LEVELS.has(level) ? level : "info";
  const payload = { event, ts: Date.now(), ...data };

  if (process.env.NODE_ENV === "development") {
    const fn = console[lvl] || console.log;
    fn.call(console, `[2mrrw:${event}]`, payload);
    return;
  }

  if (lvl === "error" || lvl === "warn") {
    if (Math.random() <= Math.min(1, PROD_SAMPLE_RATE * 5)) {
      console[lvl](`[2mrrw:${event}]`, payload);
    }
    return;
  }

  if (Math.random() > PROD_SAMPLE_RATE) return;
}

/** Playback / media path helper */
export function logPlayback(event, data) {
  clientLog("debug", event, { domain: "playback", ...data });
}
