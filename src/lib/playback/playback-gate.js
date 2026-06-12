import { membershipHasPremiumAccess } from "@/lib/commerce/entitlements";

/**
 * Server-aligned playback gate for catalog items (P1.4).
 * Requires account/state owned slugs — never catalog entitlement.canStream alone.
 */
export function catalogSlugIsOwned(slug, ownedSlugs = []) {
  if (!slug) return false;
  const set = ownedSlugs instanceof Set ? ownedSlugs : new Set(ownedSlugs || []);
  return set.has(slug);
}

export function catalogItemAllowsFullPlayback(item, track, accountState = {}) {
  if (accountState?.permissions?.admin) return true;

  const slug =
    item?.productSlug ||
    item?.product_slug ||
    track?.slug ||
    item?.slug ||
    null;
  const albumSlug = item?.albumSlug || item?.album_slug || null;
  const ownedSlugs = accountState?.ownedSlugs || [];

  if (catalogSlugIsOwned(slug, ownedSlugs) || catalogSlugIsOwned(albumSlug, ownedSlugs)) {
    return true;
  }

  const membership = accountState?.membership || null;
  const subscriptionActive =
    Boolean(accountState?.subscriberActive) || membershipHasPremiumAccess(membership);
  if (!subscriptionActive) return false;

  const permissions = accountState?.permissions || {};
  if (permissions.subscriber || accountState?.subscriberActive) return true;

  const collectorRecords = accountState?.collectorOwnerships || [];
  if (permissions.collectorAccess || permissions.collector) {
    return collectorRecords.length > 0 || permissions.collectorAccess;
  }

  return false;
}
