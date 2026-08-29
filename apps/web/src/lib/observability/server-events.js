import * as Sentry from "@sentry/nextjs";

const LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);
const SENSITIVE = /email|phone|address|token|secret|password|authorization|cookie|wrapped_data_key/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return "[depth-limited]";
  if (value instanceof Error) return { name: value.name, code: value.code || null, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    SENSITIVE.test(key) ? "[redacted]" : sanitize(item, depth + 1)]));
}

export function emitServerEvent(level, event, data = {}, error = null) {
  const severity = LEVELS.has(level) ? level : "info";
  const payload = sanitize({ schema: "2mrrw.server-event.v1", event, severity,
    timestamp: new Date().toISOString(), service: "web", ...data,
    ...(error ? { error: sanitize(error) } : {}) });
  const fn = severity === "fatal" ? console.error : console[severity] || console.info;
  fn(JSON.stringify(payload));
  if (error && ["error", "fatal"].includes(severity)) {
    Sentry.withScope((scope) => {
      scope.setLevel(severity === "fatal" ? "fatal" : "error");
      scope.setTag("event", event);
      if (data.correlationId) scope.setTag("correlation_id", data.correlationId);
      if (data.requestId) scope.setTag("request_id", data.requestId);
      scope.setContext("event_data", sanitize(data));
      Sentry.captureException(error);
    });
  }
  return payload;
}
