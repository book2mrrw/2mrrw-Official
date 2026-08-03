"use client";

/**
 * Phase P9 — catalog hasMore flag without CatalogSurface context subscription.
 */

let catalogHasMore = false;
const listeners = new Set();

export function getCatalogHasMore() {
  return catalogHasMore;
}

export function setCatalogHasMoreFlag(next) {
  const value = Boolean(next);
  if (catalogHasMore === value) return;
  catalogHasMore = value;
  listeners.forEach((listener) => listener());
}

export function subscribeCatalogHasMore(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
