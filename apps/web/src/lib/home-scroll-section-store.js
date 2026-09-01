"use client";

import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";

/** Scroll-section sync for mobile home nav — avoids full Page re-renders on intersection changes. */

let homeScrollSection = null;
const listeners = new Set();

export function getHomeScrollSection() {
  return homeScrollSection;
}

export function setHomeScrollSection(next) {
  if (homeScrollSection === next) return;
  const prev = homeScrollSection;
  homeScrollSection = next;
  if (isUiHydrationTraceEnabled()) {
    logUiHydrationTrace("SCROLL_STATE_CHANGE", { from: prev, to: next });
  }
  listeners.forEach((listener) => listener());
}

export function subscribeHomeScrollSection(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
