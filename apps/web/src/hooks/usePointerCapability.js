"use client";

import { useSyncExternalStore } from "react";

// Same signal the storefront's CSS already gates desktop-only chrome on
// (see the "(hover: hover) and (pointer: fine)" rules in globals.css) —
// true only for a real mouse/trackpad session, false for touch of any kind
// (phone, tablet, or a foldable in any posture).
const QUERY = "(hover: hover) and (pointer: fine)";

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

// SSR/first-paint snapshot: assume touch, matching this app's mobile-first
// default elsewhere (e.g. HomeClient's isMobileRef starts true).
function getServerSnapshot() {
  return false;
}

/**
 * True only when the current session has a fine pointer (mouse/trackpad).
 * Built on useSyncExternalStore so React only re-renders subscribers when
 * this genuinely changes (a foldable docked with a mouse, a touchscreen
 * laptop's mode switch) — never on resize/orientation noise, and with none
 * of the extra-render or tearing risk of a useEffect+useState polyfill.
 */
export function usePointerCapability() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
