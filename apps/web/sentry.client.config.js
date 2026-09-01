import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,
  integrations: [],
  ignoreErrors: [
    // Browser noise — not actionable
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
    "NotAllowedError",
    "AbortError",
  ],
  beforeSend(event) {
    // Strip query strings from URLs so signed R2 tokens don't appear in Sentry.
    if (event.request?.url) {
      try {
        event.request.url = new URL(event.request.url).pathname;
      } catch {}
    }
    return event;
  },
});
