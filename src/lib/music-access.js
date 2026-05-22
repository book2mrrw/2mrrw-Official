import { membershipHasPremiumAccess } from "@/lib/commerce/entitlements";
import { getOfflinePlaybackUrl } from "@/lib/offline-cache";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";

const ACTIVE_COLLECTOR_STATUSES = new Set(["active", "verified", "granted"]);

function slugSet(values = []) {
  return new Set((values || []).filter(Boolean).map((v) => String(v)));
}

function librarySlugSet(library = []) {
  const slugs = new Set();
  (library || []).forEach((item) => {
    if (item?.slug) slugs.add(item.slug);
    if (item?.product_slug) slugs.add(item.product_slug);
  });
  return slugs;
}

function purchasedSlugsFromLibrary(library = []) {
  return new Set(
    (library || [])
      .filter((item) => item?.source === "purchase" || item?.source === "gift" || item?.purchasedAt)
      .map((item) => item.slug)
      .filter(Boolean)
  );
}

function subscriptionSlugsFromLibrary(library = []) {
  return new Set(
    (library || [])
      .filter((item) => item?.membershipAccess || item?.source === "membership")
      .map((item) => item.slug)
      .filter(Boolean)
  );
}

function collectorSlugsFromLibrary(library = []) {
  return new Set(
    (library || [])
      .filter((item) => item?.collectorAccess || item?.source === "collector_access")
      .map((item) => item.slug)
      .filter(Boolean)
  );
}

function activeCollectorOwnerships(collectorOwnerships = []) {
  return (collectorOwnerships || []).filter((row) => {
    const status = String(row.entitlementStatus || row.verificationStatus || "").toLowerCase();
    return ACTIVE_COLLECTOR_STATUSES.has(status);
  });
}

/** Active collector card / ledger owner — unlocks full-catalog library + playlist adds. */
export function isCollectorCardOwner(accountState = {}) {
  const permissions = accountState.permissions || {};
  if (Boolean(permissions.collectorAccess || permissions.collector)) return true;
  return activeCollectorOwnerships(accountState.collectorOwnerships).length > 0;
}

export function canAddToLibrary(access) {
  return Boolean(access?.canAddToLibrary);
}

export function canAddToPlaylist(access) {
  return Boolean(access?.canAddToPlaylist);
}

/**
 * @param {object} track - single, album track, or catalog item with slug
 * @param {object} accountState - from /api/account/state or AuthContext
 * @returns {{ owned: boolean, subscription: boolean, collector: boolean, previewOnly: boolean, canStream: boolean, badge: string|null }}
 */
export function resolveTrackAccess(track, accountState = {}) {
  const slug = track?.slug || track?.productSlug || track?.product_slug;
  const albumSlug = track?.albumSlug || track?.album_slug;
  const empty = {
    owned: false,
    subscription: false,
    collector: false,
    collectorCardOwner: false,
    previewOnly: true,
    canStream: false,
    canAddToLibrary: false,
    canAddToPlaylist: false,
    badge: null,
  };
  if (!slug && !albumSlug) return empty;

  const ownedSlugs = slugSet(accountState.ownedSlugs);
  const library = accountState.library || [];
  const purchased = purchasedSlugsFromLibrary(library);
  const subscriptionLibrary = subscriptionSlugsFromLibrary(library);
  const collectorLibrary = collectorSlugsFromLibrary(library);

  (accountState.ownedSlugs || []).forEach((s) => ownedSlugs.add(s));

  const membership = accountState.membership || null;
  const subscriptionActive = membershipHasPremiumAccess(membership);
  const permissions = accountState.permissions || {};
  const collectorRecords = activeCollectorOwnerships(accountState.collectorOwnerships);
  const collectorCardOwner = isCollectorCardOwner(accountState);
  const hasCollectorEntitlement =
    collectorCardOwner || collectorRecords.length > 0;

  const owned =
    ownedSlugs.has(slug) ||
    ownedSlugs.has(albumSlug) ||
    purchased.has(slug) ||
    purchased.has(albumSlug);

  const subscriptionViaLibrary =
    subscriptionLibrary.has(slug) || subscriptionLibrary.has(albumSlug);
  const subscriptionGlobal =
    subscriptionActive && Boolean(permissions.subscriber);
  const subscription =
    subscriptionActive && (subscriptionViaLibrary || subscriptionGlobal);

  const collector =
    collectorCardOwner ||
    (hasCollectorEntitlement &&
      (collectorLibrary.has(slug) ||
        collectorLibrary.has(albumSlug) ||
        collectorRecords.some((row) => row.slug === slug || row.slug === albumSlug)));

  const canAddToLibrary = owned || (subscription && subscriptionActive) || collectorCardOwner;
  const canAddToPlaylist = canAddToLibrary;

  const canStreamFull =
    owned || (subscription && subscriptionActive) || collector || collectorCardOwner;
  const subscriptionExpired = Boolean(membership && !subscriptionActive && subscriptionLibrary.has(slug));

  let badge = null;
  if (owned) badge = "OWNED";
  else if (subscription && subscriptionActive) badge = "Included with Subscription";
  else if (collector) badge = "Collector Access";
  else if (subscriptionExpired) badge = "Subscription Expired";

  return {
    owned,
    subscription: subscription && subscriptionActive,
    collector,
    collectorCardOwner,
    previewOnly: !canStreamFull,
    canStream: canStreamFull,
    canAddToLibrary,
    canAddToPlaylist,
    subscriptionLocked: subscriptionExpired,
    badge,
  };
}

/**
 * Playback URL resolution (no UI changes).
 * - Entitled full audio → /api/library/stream (redirects to signed R2 GET)
 * - Previews → public R2 CDN (previews/, artwork/, digital-assets single covers)
 */
export function resolvePlaybackSrc(track, access, { userId } = {}) {
  if (!track) return "";
  if (userId && track.slug && access?.canStream) {
    const offline = getOfflinePlaybackUrl(userId, track.slug);
    if (offline) return offline;
  }
  if (access?.canStream && track.slug) {
    return `/api/library/stream?slug=${encodeURIComponent(track.slug)}&redirect=1`;
  }
  const previewPath = track.preview || track.preview_path || track.previewPath;
  if (previewPath) {
    return catalogPreviewAudioUrl(previewPath);
  }
  return track.preview || track.src || track.audio || "";
}

export function partitionLibraryByType(library = [], catalog = { singles: [], albums: [] }) {
  const singles = [];
  const albums = [];
  const seenSingle = new Set();
  const seenAlbum = new Set();

  const albumSlugs = new Set((catalog.albums || []).map((a) => a.slug));
  const singleSlugs = new Set((catalog.singles || []).map((s) => s.slug));

  (library || []).forEach((item) => {
    if (!item?.slug || item.slug.startsWith("exc-")) return;
    const type = String(item.product_type || "").toLowerCase();
    const isAlbum =
      type === "album" ||
      albumSlugs.has(item.slug) ||
      (Array.isArray(item.tracks) && item.tracks.length > 1);
    if (isAlbum) {
      if (!seenAlbum.has(item.slug)) {
        seenAlbum.add(item.slug);
        albums.push(item);
      }
    } else if (singleSlugs.has(item.slug) || type === "single" || type === "audio" || type === "digital") {
      if (!seenSingle.has(item.slug)) {
        seenSingle.add(item.slug);
        singles.push(item);
      }
    } else if (!seenSingle.has(item.slug)) {
      seenSingle.add(item.slug);
      singles.push(item);
    }
  });

  return { ownedSingles: singles, ownedAlbums: albums };
}

/**
 * Unified access for storefront + library UI.
 * @param {object} item - track, single, album, or feature
 * @param {object} accountState
 */
export function resolveContentAccess(item, accountState = {}) {
  const trackAccess = resolveTrackAccess(item, accountState);
  const membership = accountState.membership || null;
  const subscriptionActive = membershipHasPremiumAccess(membership);

  let tier = "discovery";
  if (trackAccess.collector) tier = "collector";
  else if (trackAccess.subscription && subscriptionActive) tier = "subscriber";

  const libraryMode = trackAccess.canStream;
  return {
    ...trackAccess,
    tier,
    mode: libraryMode ? "library" : "store",
    canPreview: !libraryMode,
    canStream: trackAccess.canStream,
    canAddToLibrary: trackAccess.canAddToLibrary,
    canAddToPlaylist: trackAccess.canAddToPlaylist,
    canOffline:
      trackAccess.canStream &&
      (tier === "subscriber" || tier === "collector" || trackAccess.owned),
    showPrice: !libraryMode,
    showCart: !libraryMode,
    badges: trackAccess.badge ? [trackAccess.badge] : [],
  };
}
