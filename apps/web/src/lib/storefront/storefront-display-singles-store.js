"use client";

import { catalogSinglesMediaEqual } from "@/lib/media/r2-catalog-media";

/**
 * Phase P9 — pinned Latest Singles list for storefront media rows.
 * Updates only when slug order or media signatures change (not loading/auth).
 */

let pinnedSingles = [];
const listeners = new Set();

export function getStorefrontDisplaySingles() {
  return pinnedSingles;
}

export function commitStorefrontDisplaySingles(next) {
  const list = Array.isArray(next) ? next : [];
  if (!list.length) return;
  if (!pinnedSingles.length) {
    pinnedSingles = list;
    listeners.forEach((listener) => listener());
    return;
  }
  if (catalogSinglesMediaEqual(pinnedSingles, list)) return;
  pinnedSingles = list;
  listeners.forEach((listener) => listener());
}

export function subscribeStorefrontDisplaySingles(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
