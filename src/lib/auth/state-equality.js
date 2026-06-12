/** Shallow equality helpers for AuthContext churn guards (no deep object compare). */

export function slugSetsEqual(a, b) {
  if (a === b) return true;
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  for (const slug of a) {
    if (!b.has(slug)) return false;
  }
  return true;
}

export function libraryItemsShallowEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    const leftKey = left?.slug ?? left?.id ?? null;
    const rightKey = right?.slug ?? right?.id ?? null;
    if (leftKey !== rightKey) return false;
  }
  return true;
}

export function ownedSlugsArraysEqual(a, b) {
  if (a === b) return true;
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * Compare entitlement-bearing accountState snapshots (ignores syncedAt).
 */
export function accountStateShallowEqual(prev, next) {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return (
    libraryItemsShallowEqual(prev.library, next.library) &&
    ownedSlugsArraysEqual(prev.ownedSlugs, next.ownedSlugs) &&
    prev.subscriberActive === next.subscriberActive &&
    prev.collectorCard === next.collectorCard &&
    prev.vaultAccess === next.vaultAccess &&
    (prev.membership?.id ?? prev.membership?.status ?? null) ===
      (next.membership?.id ?? next.membership?.status ?? null) &&
    prev.isAdmin === next.isAdmin &&
    (prev.user?.id ?? null) === (next.user?.id ?? null) &&
    Boolean(prev.permissions?.admin) === Boolean(next.permissions?.admin)
  );
}
