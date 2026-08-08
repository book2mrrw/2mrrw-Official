/** Entitlement snapshot + refresh gating (Phase: entitlement-snapshot). */

export const ENTITLEMENT_REFRESH_DEBOUNCE_MS = 10_000;
export const ENTITLEMENT_RENDER_LOOP_MS = 800;

export const ALLOWED_REFRESH_REASONS = new Set([
  "auth:login",
  "auth:bootstrap",
  "purchase:completed",
  "subscription:updated",
  "collector:updated",
  "manual",
  "library:change",
]);

const LEGACY_REASON_MAP = {
  "checkout-success": "purchase:completed",
  "purchase-confirmed": "purchase:completed",
  invoke: "manual",
};

/**
 * @param {{ reason?: string, source?: string, force?: boolean }} [meta]
 * @returns {string | null} canonical reason or null if not allowlisted
 */
export function normalizeRefreshReason(meta = {}) {
  const raw = String(meta.reason || "").trim();
  if (ALLOWED_REFRESH_REASONS.has(raw)) return raw;

  const mapped = LEGACY_REASON_MAP[raw];
  if (mapped) return mapped;

  if (raw === "initial" || /^poll-\d+$/.test(raw)) {
    const source = String(meta.source || "");
    if (source.includes("subscribe")) return "subscription:updated";
    if (source.includes("success") || source.includes("page.js")) return "purchase:completed";
    if (source.includes("collector")) return "collector:updated";
    return "manual";
  }

  return null;
}

/**
 * @param {Record<string, unknown>} data - /api/account/state payload
 * @param {string | null} userId
 * @param {number} [prevVersion]
 */
export function buildEntitlementSnapshot(data = {}, userId = null, prevVersion = 0) {
  const items = data.library || data.items || [];
  const slugs = data.ownedSlugs || items.map((i) => i.slug).filter(Boolean);
  const vaultDetail =
    data.vaultAccessDetail ||
    (typeof data.vaultAccess === "object" && data.vaultAccess !== null ? data.vaultAccess : null);
  const vaultAccess = Boolean(
    typeof data.vaultAccess === "boolean"
      ? data.vaultAccess
      : vaultDetail?.fullAccess || vaultDetail?.hasVaultPass
  );
  const permissions = { ...(data.permissions || {}) };

  return {
    userId: userId ?? data.user?.id ?? null,
    subscriberActive: Boolean(data.subscriberActive),
    collectorCard: Boolean(data.collectorCard),
    ownedSlugs: Array.isArray(slugs) ? [...slugs] : [],
    permissions,
    vaultAccess,
    playbackPolicy: data.playbackPolicy || null,
    lastUpdated: Date.now(),
    version: prevVersion + 1,
  };
}

/**
 * API-shaped payload for callers when refresh is skipped (blocked / cached).
 * @param {ReturnType<typeof buildEntitlementSnapshot> | null} snapshot
 * @param {object} [accountState] - current React account slice for non-entitlement fields
 */
export function snapshotToAccountPayload(snapshot, accountState = {}) {
  if (!snapshot) return null;
  return {
    user: snapshot.userId ? accountState.user || { id: snapshot.userId } : accountState.user || null,
    library: accountState.library || [],
    ownedSlugs: snapshot.ownedSlugs,
    subscriberActive: snapshot.subscriberActive,
    collectorCard: snapshot.collectorCard,
    vaultAccess: snapshot.vaultAccess,
    permissions: snapshot.permissions,
    playbackPolicy: snapshot.playbackPolicy ?? accountState.playbackPolicy ?? null,
    membership: accountState.membership ?? null,
    collectorOwnerships: accountState.collectorOwnerships || [],
    mediaProgress: accountState.mediaProgress || [],
    vaultAccessDetail: accountState.vaultAccessDetail ?? null,
    syncedAt: accountState.syncedAt ?? null,
    _fromEntitlementSnapshot: true,
  };
}
