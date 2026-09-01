/**
 * Platform session playback policy.
 *
 * USER_TIER is resolved once at session creation from Supabase state.
 * PLAYBACK_POLICY maps tier to a capability constant that every downstream
 * system reads as its access gate.
 *
 * Per-click entitlement rechecks do NOT happen for FULL_CATALOG or UNRESTRICTED
 * tiers — the policy field is the resolved signal.
 *
 * Tier priority:   admin → collector → subscriber → purchaser → entry
 * Policy mapping:  admin → UNRESTRICTED
 *                  collector → FULL_CATALOG
 *                  subscriber → FULL_CATALOG
 *                  purchaser → PURCHASE_LIBRARY  (per-slug check required)
 *                  entry → PREVIEW_ONLY
 */

export const USER_TIER = /** @type {const} */ ({
  ADMIN:      "admin",
  COLLECTOR:  "collector",
  SUBSCRIBER: "subscriber",
  PURCHASER:  "purchaser",
  ENTRY:      "entry",
});

export const PLAYBACK_POLICY = /** @type {const} */ ({
  UNRESTRICTED:     "UNRESTRICTED",      // admin — full catalog, all access
  FULL_CATALOG:     "FULL_CATALOG",      // collector + subscriber
  PURCHASE_LIBRARY: "PURCHASE_LIBRARY",  // purchaser — per-slug ownership check
  PREVIEW_ONLY:     "PREVIEW_ONLY",      // entry — 15s preview clips only
});

/**
 * Derive user tier from resolved account permissions.
 * @param {object} permissions
 * @param {string[]} [ownedSlugs]
 * @returns {string} USER_TIER constant
 */
export function deriveUserTier(permissions = {}, ownedSlugs = []) {
  if (!permissions) return USER_TIER.ENTRY;
  if (permissions.admin) return USER_TIER.ADMIN;
  if (permissions.collectorAccess || permissions.collector) return USER_TIER.COLLECTOR;
  if (permissions.subscriber) return USER_TIER.SUBSCRIBER;
  if (Array.isArray(ownedSlugs) && ownedSlugs.length > 0) return USER_TIER.PURCHASER;
  return USER_TIER.ENTRY;
}

/**
 * Map user tier to playback policy constant.
 * @param {string} tier USER_TIER constant
 * @returns {string} PLAYBACK_POLICY constant
 */
export function derivePlaybackPolicy(tier) {
  switch (tier) {
    case USER_TIER.ADMIN:      return PLAYBACK_POLICY.UNRESTRICTED;
    case USER_TIER.COLLECTOR:  return PLAYBACK_POLICY.FULL_CATALOG;
    case USER_TIER.SUBSCRIBER: return PLAYBACK_POLICY.FULL_CATALOG;
    case USER_TIER.PURCHASER:  return PLAYBACK_POLICY.PURCHASE_LIBRARY;
    default:                   return PLAYBACK_POLICY.PREVIEW_ONLY;
  }
}

/** True when policy grants unrestricted or full-catalog streaming (no per-slug checks). */
export function policyCanStream(policy) {
  return policy === PLAYBACK_POLICY.UNRESTRICTED || policy === PLAYBACK_POLICY.FULL_CATALOG;
}

/** True when policy requires per-slug ownership check before granting stream access. */
export function policyNeedsSlugCheck(policy) {
  return policy === PLAYBACK_POLICY.PURCHASE_LIBRARY;
}

/** True when policy restricts the user to preview-only clips. */
export function policyIsPreviewOnly(policy) {
  return !policy || policy === PLAYBACK_POLICY.PREVIEW_ONLY;
}

/** Human-readable label for UI display and analytics. */
export function policyDisplayLabel(policy) {
  switch (policy) {
    case PLAYBACK_POLICY.UNRESTRICTED:     return "Admin";
    case PLAYBACK_POLICY.FULL_CATALOG:     return "Full Catalog";
    case PLAYBACK_POLICY.PURCHASE_LIBRARY: return "Library";
    case PLAYBACK_POLICY.PREVIEW_ONLY:     return "Preview";
    default:                               return "Preview";
  }
}

/** Tier display label for analytics and admin tooling. */
export function tierDisplayLabel(tier) {
  switch (tier) {
    case USER_TIER.ADMIN:      return "Admin";
    case USER_TIER.COLLECTOR:  return "Collector";
    case USER_TIER.SUBSCRIBER: return "Subscriber";
    case USER_TIER.PURCHASER:  return "Purchaser";
    default:                   return "Entry";
  }
}
