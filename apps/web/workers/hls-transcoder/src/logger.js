/**
 * Structured JSON logger.
 * All output is written to stdout — Fly.io aggregates and ships to your log sink.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function emit(level, msg, meta = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }) + "\n"
  );
}

export const logger = {
  debug: (msg, meta) => emit("debug", msg, meta),
  info:  (msg, meta) => emit("info",  msg, meta),
  warn:  (msg, meta) => emit("warn",  msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
};
