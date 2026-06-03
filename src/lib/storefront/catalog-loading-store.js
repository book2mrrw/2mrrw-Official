"use client";

/**
 * Phase P7 — catalog loading flag isolated from CatalogSurfaceProvider reconcile.
 * Skeleton/load-more leaves subscribe here; media cards must not.
 */

let catalogLoading = false;
const listeners = new Set();

export function getCatalogLoading() {
  return catalogLoading;
}

export function setCatalogLoading(next) {
  if (catalogLoading === next) return;
  catalogLoading = next;
  listeners.forEach((listener) => listener());
}

export function subscribeCatalogLoading(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
