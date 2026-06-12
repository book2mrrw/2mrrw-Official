/**
 * Permanent library rows (purchase / gift / grant) survive subscription lapse.
 * Virtual catalog rows (membership, collector_access, admin) are access-only.
 */

const PERMANENT_SOURCES = new Set(["purchase", "gift", "grant", "collector_unlock"]);

export function isPermanentLibrarySource(source) {
  const s = String(source || "").toLowerCase();
  return PERMANENT_SOURCES.has(s);
}

export function isPermanentLibraryItem(item) {
  if (!item?.slug) return false;
  if (item.gifted) return true;
  if (isPermanentLibrarySource(item.source)) return true;
  if (item.purchasedAt && !item.membershipAccess && !item.collectorAccess) {
    const s = String(item.source || "").toLowerCase();
    if (s !== "membership" && s !== "collector_access" && s !== "admin") return true;
  }
  return false;
}

export function isStreamingLibraryItem(item) {
  if (!item?.slug) return false;
  return Boolean(item.membershipAccess || item.source === "membership");
}

export function isCollectorLibraryItem(item) {
  if (!item?.slug) return false;
  return Boolean(item.collectorAccess || item.source === "collector_access");
}

export function permanentOwnedSlugsFromLibrary(library = []) {
  return [...new Set((library || []).filter(isPermanentLibraryItem).map((i) => i.slug).filter(Boolean))];
}

export function permanentOwnedSlugsFromState(accountState = {}) {
  const fromLibrary = permanentOwnedSlugsFromLibrary(accountState.library || []);
  const explicit = (accountState.ownedSlugs || []).filter(Boolean);
  const collectorLedger = (accountState.collectorOwnerships || [])
    .filter((row) => {
      const status = String(row.entitlementStatus || row.verificationStatus || "").toLowerCase();
      return status === "active" || status === "verified" || status === "granted";
    })
    .map((row) => row.slug)
    .filter(Boolean);
  return [...new Set([...fromLibrary, ...explicit, ...collectorLedger])];
}
