"use client";

/**
 * Phase P9 — pinned Latest Singles list for storefront media rows.
 * The provider performs deterministic reconciliation; this store preserves its
 * exact committed snapshot, including authoritative empty and metadata-only
 * changes that intentionally keep the same media URLs.
 */

let pinnedSingles = [];
const listeners = new Set();

export function getStorefrontDisplaySingles() {
  return pinnedSingles;
}

export function commitStorefrontDisplaySingles(next) {
  const list = Array.isArray(next) ? next : [];
  if (Object.is(pinnedSingles, list)) return;
  pinnedSingles = list;
  listeners.forEach((listener) => listener());
}

export function subscribeStorefrontDisplaySingles(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
