"use client";

import posthog from "posthog-js";

let initialized = false;

export function initPosthog() {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  if (initialized) return;
  initialized = true;
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.opt_out_capturing();
    },
  });
}

export function flushToPosthog(events) {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  events.forEach((event) => {
    posthog.capture(event.type, sanitizeForPosthog(event));
  });
}

function sanitizeForPosthog(event) {
  const safe = { ...event };
  if (safe.url) safe.url = stripQueryParams(safe.url);
  if (safe.src) safe.src = stripQueryParams(safe.src);
  delete safe.stack;
  return safe;
}

function stripQueryParams(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "[url]";
  }
}
