import {
  extractControlSystemArray,
  extractControlSystemRecord,
  fetchControlSystemJson,
} from "./client";

function mapLibraryItem(item = {}) {
  return {
    slug: item.slug || item.productSlug || item.product_slug || item.releaseSlug || item.release_slug,
    title: item.title || item.productTitle || item.product_title || item.releaseTitle || item.release_title || "Untitled",
    product_type: item.product_type || item.productType || item.type || "digital",
    cover: item.cover || item.coverUrl || item.cover_url || item.artworkUrl || item.artwork_url || null,
    source: item.source || item.entitlementSource || item.entitlement_source || "control_system",
    gifted: Boolean(item.gifted),
    membershipAccess: Boolean(item.membershipAccess || item.membership_access),
    collectorAccess: Boolean(item.collectorAccess || item.collector_access),
    purchasedAt: item.purchasedAt || item.purchased_at || item.grantedAt || item.granted_at || null,
    entitlement: item.entitlement || null,
  };
}

export function mapControlSystemAccountState(payload, fallbackState = {}) {
  const account = extractControlSystemRecord(payload, ["account", "state"]) || payload || {};
  const library = extractControlSystemArray(account, ["library", "items"]).map(mapLibraryItem).filter((item) => item.slug);
  const ownedSlugs = Array.isArray(account.ownedSlugs || account.owned_slugs)
    ? account.ownedSlugs || account.owned_slugs
    : library.map((item) => item.slug).filter(Boolean);

  return {
    ...fallbackState,
    user: account.user || account.profile || fallbackState.user || null,
    library: library.length > 0 ? library : fallbackState.library || [],
    ownedSlugs,
    membership: account.membership || fallbackState.membership || null,
    collectorOwnerships: account.collectorOwnerships || account.collector_ownerships || fallbackState.collectorOwnerships || [],
    vaultAccess: account.vaultAccess || account.vault_access || fallbackState.vaultAccess || { tier: "public" },
    mediaProgress: account.mediaProgress || account.media_progress || fallbackState.mediaProgress || [],
    notifications: account.notifications || fallbackState.notifications || null,
    permissions: account.permissions || fallbackState.permissions || {},
    session: account.session || fallbackState.session || null,
    syncedAt: account.syncedAt || account.synced_at || new Date().toISOString(),
    source: "control-system",
  };
}

export async function getControlSystemAccountState({ fallbackState = {} } = {}) {
  const { ok, payload } = await fetchControlSystemJson("/api/account/state", { fetchOptions: { credentials: "include" } });
  if (!ok) return { ...fallbackState, source: "fallback" };
  return mapControlSystemAccountState(payload, fallbackState);
}

export async function getControlSystemLibraryState({ fallbackItems = [] } = {}) {
  const { ok, payload } = await fetchControlSystemJson("/api/library", { fetchOptions: { credentials: "include" } });
  if (!ok) return { items: fallbackItems, ownedSlugs: fallbackItems.map((item) => item.slug).filter(Boolean), source: "fallback" };

  const items = extractControlSystemArray(payload, ["items", "library"]).map(mapLibraryItem).filter((item) => item.slug);
  return {
    items: items.length > 0 ? items : fallbackItems,
    ownedSlugs: (extractControlSystemRecord(payload, ["library"])?.ownedSlugs || payload?.ownedSlugs || items.map((item) => item.slug)).filter(Boolean),
    source: items.length > 0 ? "control-system" : "fallback",
  };
}
