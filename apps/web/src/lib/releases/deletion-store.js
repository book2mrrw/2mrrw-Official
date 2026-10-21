"use client";

import { useSyncExternalStore } from "react";

const EMPTY = Object.freeze([]);
const STORAGE_KEY = "2mrrw.release-deletions.v1";
let slugs = EMPTY;
const listeners = new Set();
export const getDeletedReleaseSnapshot = () => slugs;
const serverSnapshot = () => EMPTY;
function restore() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) commitDeletedReleaseSlugs(saved.filter((slug) => typeof slug === "string"));
  } catch { /* Restricted storage must not prevent catalog reconciliation. */ }
}
const subscribe = (listener) => {
  listeners.add(listener);
  if (typeof window !== "undefined" && listeners.size === 1) {
    window.addEventListener("storage", restore);
    restore();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", restore);
  };
};

// Monotonic within a session: an older in-flight response cannot undo deletion.
export function commitDeletedReleaseSlugs(incoming) {
  const next = [...new Set([...slugs, ...incoming])].sort();
  if (next.length === slugs.length && next.every((slug, i) => slug === slugs[i])) return false;
  slugs = Object.freeze(next);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs)); } catch { /* Memory remains authoritative for this tab. */ }
  }
  for (const listener of [...listeners]) listener();
  return true;
}

export function useDeletedReleaseSlugs() {
  return useSyncExternalStore(subscribe, getDeletedReleaseSnapshot, serverSnapshot);
}
