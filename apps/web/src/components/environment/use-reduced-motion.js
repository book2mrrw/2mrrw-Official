"use client";

import { useSyncExternalStore } from "react";

// Mirrors apps/web/src/hooks/usePointerCapability.js's exact pattern —
// useSyncExternalStore over a matchMedia query, so subscribers only
// re-render when this genuinely changes, never on unrelated noise.
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

/** True when the user has requested reduced motion at the OS/browser level. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
