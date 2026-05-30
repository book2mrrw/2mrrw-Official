import { membershipHasPremiumAccess } from "@/lib/commerce/entitlements";
import { isAdminUser } from "@/lib/auth/constants";
import { permanentOwnedSlugsFromState } from "@/lib/library-ownership";
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
  if (Boolean(accountState.collectorCard)) return true;
  const permissions = accountState.permissions || {};
  if (Boolean(permissions.collectorAccess || permissions.collector)) return true;
  return activeCollectorOwnerships(accountState.collectorOwnerships).length > 0;
}

/** Platform admin — full catalog access, no purchase UI. */
export function isAdminAccount(accountState = {}) {
  if (Boolean(accountState?.permissions?.admin)) return true;
  if (Boolean(accountState?.isAdmin)) return true;
  const user = accountState?.user;
  if (user && isAdminUser(user)) return true;
  return false;
}

export function adminTrackAccess() {
  return {
    owned: true,
    subscription: true,
    collector: true,
    collectorCardOwner: true,
    previewOnly: false,
    canStream: true,
    canAddToLibrary: true,
    canAddToPlaylist: true,
    canShare: true,
    subscriptionLocked: false,
    badge: null,
    admin: true,
  };
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
  if (accountState?.permissions?.admin === true) {
    return {
      canStream: true,
      previewOnly: false,
      owned: true,
      source: "admin",
    };
  }

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
    canShare: false,
    badge: null,
  };
  if (!slug && !albumSlug) return empty;

  if (isAdminAccount(accountState)) {
    return adminTrackAccess();
  }

  const ownedSlugs = slugSet(permanentOwnedSlugsFromState(accountState));
  const library = accountState.library || [];
  const purchased = purchasedSlugsFromLibrary(library);
  const subscriptionLibrary = subscriptionSlugsFromLibrary(library);
  const collectorLibrary = collectorSlugsFromLibrary(library);

  const membership = accountState.membership || null;
  const subscriptionActive =
    Boolean(accountState.subscriberActive) || membershipHasPremiumAccess(membership);
  const permissions = accountState.permissions || {};
  const collectorRecords = activeCollectorOwnerships(accountState.collectorOwnerships);
  const collectorCardOwner =
    Boolean(accountState.collectorCard) || isCollectorCardOwner(accountState);
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
    subscriptionActive &&
    (Boolean(permissions.subscriber) || Boolean(accountState.subscriberActive)) &&
    (subscriptionViaLibrary || subscriptionGlobal);

  const collector =
    collectorCardOwner ||
    (hasCollectorEntitlement &&
      (collectorLibrary.has(slug) ||
        collectorLibrary.has(albumSlug) ||
        collectorRecords.some((row) => row.slug === slug || row.slug === albumSlug)));

  const canAddToLibrary = owned || (subscription && subscriptionActive) || collectorCardOwner;
  const canAddToPlaylist = canAddToLibrary;
  const canShare = true;

  const isSubscriber =
    subscriptionActive &&
    Boolean(accountState.subscriberActive) &&
    Boolean(permissions.subscriber);
  const canStreamFull = owned || isSubscriber || collectorCardOwner;
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
    canShare,
    subscriptionLocked: subscriptionExpired,
    badge,
  };
}

/** Fast-path library stream URL — browser loads same-origin proxy (Range-safe). */
export function libraryStreamRedirectSrc(slug, { trackSlug = null } = {}) {
  if (!slug) return "";
  const params = new URLSearchParams({ slug, redirect: "1" });
  if (trackSlug) params.set("trackSlug", String(trackSlug));
  return `/api/library/stream?${params.toString()}`;
}

/**
 * Playback URL resolution (no UI changes).
 * - Entitled full audio → /api/library/stream (proxied signed R2 GET)
 * - Previews → public R2 CDN (previews/, artwork/, digital-assets single covers)
 */
/** Full stream only when client user matches server account/state user (cookie session aligned). */
export function canRequestLibraryStream(access, { userId, accountState } = {}) {
  if (!access?.canStream || !userId) return false;
  const serverUserId = accountState?.user?.id;
  if (!serverUserId) return false;
  return serverUserId === userId;
}

export function resolvePlaybackSrc(track, access, { userId, accountState } = {}) {
  if (!track) return "";
  if (userId && track.slug && access?.canStream) {
    const offline = getOfflinePlaybackUrl(userId, track.slug);
    if (offline) return offline;
  }
  if (canRequestLibraryStream(access, { userId, accountState }) && track.slug) {
    const trackSlug =
      track.trackSlug ||
      track.track_slug ||
      track.metadata?.trackSlug ||
      track.metadata?.track_slug ||
      null;
    return libraryStreamRedirectSrc(track.slug, { trackSlug });
  }
  const previewPath = track.preview || track.preview_path || track.previewPath;
  if (previewPath) {
    return catalogPreviewAudioUrl(previewPath);
  }
  return track.preview || track.src || track.audio || "";
}

export function partitionLibraryByType(
  library = [],
  catalog = { singles: [], albums: [], mixtapesAndEps: [] }
) {
  const singles = [];
  const albums = [];
  const mixtapes = [];
  const eps = [];
  const seenSingle = new Set();
  const seenAlbum = new Set();
  const seenMixtape = new Set();
  const seenEp = new Set();

  const albumSlugs = new Set((catalog.albums || []).map((a) => a.slug));
  const singleSlugs = new Set((catalog.singles || []).map((s) => s.slug));
  const epSlugs = new Set();
  const mixtapeSlugs = new Set();
  (catalog.mixtapesAndEps || []).forEach((release) => {
    if (release.release_category === "EP" || release.release_type === "ep") {
      epSlugs.add(release.slug);
    } else {
      mixtapeSlugs.add(release.slug);
    }
  });

  const resolveMultiTrackCategory = (item) => {
    const slug = item?.slug;
    if (slug && epSlugs.has(slug)) return "ep";
    if (slug && mixtapeSlugs.has(slug)) return "mixtape";
    if (slug && albumSlugs.has(slug)) return "album";
    const category = String(
      item?.metadata?.release_category || item?.release_category || ""
    ).trim();
    if (category === "EP") return "ep";
    if (category === "Mixtape") return "mixtape";
    const releaseType = String(
      item?.metadata?.release_type || item?.release_type || item?.product_type || ""
    ).toLowerCase();
    if (releaseType === "ep") return "ep";
    if (releaseType === "mixtape") return "mixtape";
    return "album";
  };

  (library || []).forEach((item) => {
    if (!item?.slug || item.slug.startsWith("exc-")) return;
    const type = String(item.product_type || "").toLowerCase();
    const isMultiTrack =
      type === "album" ||
      type === "ep" ||
      type === "mixtape" ||
      albumSlugs.has(item.slug) ||
      epSlugs.has(item.slug) ||
      mixtapeSlugs.has(item.slug) ||
      (Array.isArray(item.tracks) && item.tracks.length > 1);

    if (isMultiTrack) {
      const bucket = resolveMultiTrackCategory(item);
      if (bucket === "ep") {
        if (!seenEp.has(item.slug)) {
          seenEp.add(item.slug);
          eps.push(item);
        }
        return;
      }
      if (bucket === "mixtape") {
        if (!seenMixtape.has(item.slug)) {
          seenMixtape.add(item.slug);
          mixtapes.push(item);
        }
        return;
      }
      if (!seenAlbum.has(item.slug)) {
        seenAlbum.add(item.slug);
        albums.push(item);
      }
      return;
    }

    if (singleSlugs.has(item.slug) || type === "single" || type === "audio" || type === "digital") {
      if (!seenSingle.has(item.slug)) {
        seenSingle.add(item.slug);
        singles.push(item);
      }
    } else if (!seenSingle.has(item.slug)) {
      seenSingle.add(item.slug);
      singles.push(item);
    }
  });

  return { ownedSingles: singles, ownedAlbums: albums, ownedMixtapes: mixtapes, ownedEps: eps };
}

/**
 * Unified access for storefront + library UI.
 * @param {object} item - track, single, album, or feature
 * @param {object} accountState
 */
/** True when inline card play or preview stream should be offered. */
export function itemHasPlayableAudio(item, access) {
  if (!item) return false;
  if (access?.canStream || access?.canPreview) return true;
  if (item.preview || item.preview_path || item.previewPath) return true;
  const tracks = item.tracks || item.trackTitles;
  return Array.isArray(tracks) && tracks.length > 0;
}

export function resolveContentAccess(item, accountState = {}) {
  const trackAccess = resolveTrackAccess(item, accountState);
  const membership = accountState.membership || null;
  const subscriptionActive = membershipHasPremiumAccess(membership);

  if (trackAccess.admin) {
    return {
      ...trackAccess,
      tier: "admin",
      mode: "library",
      canPreview: false,
      canStream: true,
      canAddToLibrary: true,
      canAddToPlaylist: true,
      canShare: true,
      canOffline: true,
      showPrice: false,
      showCart: false,
      badges: [],
    };
  }

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
    canShare: trackAccess.canShare,
    canOffline:
      trackAccess.canStream &&
      (tier === "subscriber" || tier === "collector" || trackAccess.owned),
    showPrice: !libraryMode,
    showCart: !libraryMode,
    badges: trackAccess.badge ? [trackAccess.badge] : [],
  };
}
