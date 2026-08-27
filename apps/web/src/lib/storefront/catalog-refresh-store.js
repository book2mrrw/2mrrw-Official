"use client";

// Same-document catalog invalidation for successful admin mutations. The
// server remains the sole catalog authority: this store carries only a
// monotonically increasing revision, never catalog data or an optimistic
// projection of a write.
let revision = 0;
const listeners = new Set();

export function getCatalogRefreshRevision() {
  return revision;
}

export function getCatalogRefreshServerRevision() {
  return 0;
}

export function subscribeCatalogRefresh(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce that a catalog-affecting mutation committed successfully.
 * `reason` is intentionally diagnostic only; consumers always reload the
 * canonical first page instead of attempting mutation-specific patch logic.
 */
export function signalCatalogMutation(reason = "catalog_mutation") {
  void reason;
  revision += 1;
  for (const listener of [...listeners]) listener();
  return revision;
}
