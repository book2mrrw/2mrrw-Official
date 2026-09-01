"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ImmersivePreviewModal, { AlbumModal } from "@/components/preview/ImmersivePreviewModal";
import { useAuth, useEntitlementAccountState } from "@/context/AuthContext";
import { ModalErrorBoundary } from "@/system/errors";
import { getControlSystemReleaseDetail } from "@/lib/control-system/releases";
import { resolveTrackAccess } from "@/lib/music-access";
import {
  albumTracksForPlayback,
  playableReleaseQueue,
  resolveReleaseQueueStartIndex,
} from "@/lib/music-playback";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";
import { getCatalogSurfaceRef } from "@/lib/storefront/catalog-surface-ref";
import {
  closePlayerReleaseModal,
  getPlayerReleaseModalServerSnapshot,
  getPlayerReleaseModalSnapshot,
  openPlayerReleaseModal,
  resolvePlayerReleaseModalKind,
  subscribePlayerReleaseModal,
} from "@/lib/storefront/player-release-modal-bridge";

const CART_KEY = "2mrrw_cart";

function formatTime(seconds) {
  if (!seconds || !Number.isFinite(Number(seconds))) return null;
  const value = Number(seconds);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function normalizeAlbumTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((track, index) => {
    if (typeof track === "string") {
      return {
        id: index + 1,
        slug: null,
        title: track,
        feat: null,
        dur: null,
        durSec: 0,
        free: false,
      };
    }
    const duration = track?.dur ?? track?.duration ?? track?.durationSeconds ?? null;
    return {
      ...track,
      id: track?.id ?? index + 1,
      slug: track?.slug || track?.trackSlug || track?.track_slug || null,
      title: track?.title || `Track ${index + 1}`,
      feat: track?.feat || track?.featuring || null,
      dur: typeof duration === "number" ? formatTime(duration) : duration,
      durSec: track?.durSec ?? track?.durationSeconds ?? (typeof duration === "number" ? duration : 0),
      free: Boolean(track?.free),
      lyrics: track?.lyrics || track?.lyricsText || null,
    };
  });
}

function releaseFallback(track, releaseSlug) {
  if (!track || !releaseSlug) return null;
  const metadata = track.metadata || {};
  const isAlbumTrack = Boolean(metadata.albumSlug || track.albumSlug);
  return {
    ...track,
    id: isAlbumTrack ? (metadata.releaseId || releaseSlug) : track.id,
    slug: releaseSlug,
    title: isAlbumTrack
      ? (metadata.albumTitle || track.album || metadata.releaseTitle || track.title)
      : track.title,
    type: isAlbumTrack
      ? (metadata.releaseType || track.release_type || "album")
      : (track.type || metadata.releaseType),
    release_type: isAlbumTrack
      ? (metadata.releaseType || track.release_type || "album")
      : track.release_type,
    cover: track.baseCover || track.cover || track.artwork || metadata.artwork,
    baseCover: track.baseCover || track.cover || track.artwork || metadata.artwork,
    tracks: Array.isArray(metadata.releaseTracks)
      ? metadata.releaseTracks
      : (Array.isArray(track.tracks) ? track.tracks : []),
  };
}

function addPersistentCartItem(item) {
  if (typeof window === "undefined" || !item) return;
  let cart = [];
  try {
    const stored = window.localStorage.getItem(CART_KEY);
    cart = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(cart)) cart = [];
  } catch {
    cart = [];
  }
  const next = [...cart, item];
  try {
    window.localStorage.setItem(CART_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("2mrrw:cart-updated", { detail: { cart: next } }));
  } catch {
    // Storage can be unavailable in strict/private contexts; keep the modal responsive.
  }
}

/**
 * Persistent render island for release details opened from the global player.
 * Route content and the player are siblings, so opening this island cannot
 * reconcile or replace either one.
 */
export default function PlayerReleaseModalHost() {
  const snapshot = useSyncExternalStore(
    subscribePlayerReleaseModal,
    getPlayerReleaseModalSnapshot,
    getPlayerReleaseModalServerSnapshot
  );
  const auth = useAuth();
  const { refreshAccountState, refreshLibrary } = auth;
  const entitlementAccountState = useEntitlementAccountState();
  const [resolvedDetail, setResolvedDetail] = useState(null);

  const fallbackRelease = useMemo(() => {
    if (!snapshot.track || !snapshot.releaseSlug) return null;
    return (
      getCatalogSurfaceRef().catalogPlaybackLookup?.bySlug?.get(snapshot.releaseSlug) ||
      releaseFallback(snapshot.track, snapshot.releaseSlug)
    );
  }, [snapshot.track, snapshot.releaseSlug]);

  useEffect(() => {
    if (!snapshot.releaseSlug || !fallbackRelease) return undefined;
    let cancelled = false;
    void getControlSystemReleaseDetail({
      slug: snapshot.releaseSlug,
      fallbackRelease,
    }).then((detail) => {
      if (!cancelled && detail?.slug === snapshot.releaseSlug) {
        setResolvedDetail({ slug: snapshot.releaseSlug, value: detail });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot.releaseSlug, fallbackRelease]);

  const release =
    resolvedDetail?.slug === snapshot.releaseSlug
      ? resolvedDetail.value
      : fallbackRelease;
  const modalKind = resolvePlayerReleaseModalKind(release, snapshot.track);
  const accountState = useMemo(
    () => ({
      ...entitlementAccountState,
      userId: auth.currentUser?.id,
      isAdmin: auth.isAdmin,
    }),
    [entitlementAccountState, auth.currentUser?.id, auth.isAdmin]
  );
  const access = resolveTrackAccess(release, accountState)?.canStream ? "full" : "preview";

  const album = useMemo(() => {
    if (!release || modalKind !== "album") return null;
    return {
      ...release,
      tracks: normalizeAlbumTracks(release.tracks || []),
      price:
        release.price != null && Number.isFinite(Number(release.price))
          ? `$${Number(release.price).toFixed(2)}`
          : release.price,
    };
  }, [release, modalKind]);

  const otherReleases = useMemo(() => {
    if (modalKind !== "album") return [];
    const seen = new Set();
    return Array.from(
      getCatalogSurfaceRef().catalogPlaybackLookup?.bySlug?.values?.() || []
    ).filter((item) => {
      const kind = resolvePlayerReleaseModalKind(item, null);
      if (kind !== "album" || item?.slug === release?.slug || seen.has(item?.slug)) return false;
      seen.add(item.slug);
      return true;
    });
  }, [modalKind, release?.slug]);

  const playAlbumTrackAtIndex = useCallback(
    async (releaseTrackIndex, accountStateOverride) => {
      if (!release) return false;
      const effectiveAccountState = accountStateOverride || accountState;
      const allTracks = albumTracksForPlayback(
        release,
        effectiveAccountState,
        "player_release_modal",
        getCatalogSurfaceRef().catalogPlaybackLookup
      );
      const playableTracks = playableReleaseQueue(allTracks, effectiveAccountState);
      if (!playableTracks.length) return false;
      const sourceTrack = allTracks[releaseTrackIndex] || null;
      const startIndex = resolveReleaseQueueStartIndex(
        playableTracks,
        releaseTrackIndex,
        sourceTrack
      );
      return Boolean(
        await getPagePlaybackActionsBridge()?.playQueue?.(
          playableTracks,
          startIndex,
          { resumeAt: 0 }
        )
      );
    },
    [release, accountState]
  );

  const handleLibraryChange = useCallback(() => {
    void refreshAccountState?.({
      reason: "library:change",
      source: "player-release-modal",
    });
    void refreshLibrary?.({
      reason: "library:change",
      source: "player-release-modal",
    });
  }, [refreshAccountState, refreshLibrary]);

  const addVinylToCart = useCallback((item) => {
    addPersistentCartItem({
      title: `${item?.title || "Release"} – Vinyl`,
      slug: `${item?.slug || "release"}-vinyl`,
      cover: item?.cover,
      price: 47.99,
    });
  }, []);

  if (!release) {
    return <div data-player-release-modal-host aria-hidden="true" />;
  }

  return (
    <div data-player-release-modal-host>
      {modalKind === "album" ? (
        <ModalErrorBoundary
          stackId="player-release-album-modal"
          onClose={closePlayerReleaseModal}
          resetKey={release.slug || release.id || "player-release-album"}
        >
          <AlbumModal
            album={album}
            access={access}
            open={snapshot.open}
            persistent
            onClose={closePlayerReleaseModal}
            onPlayTrackAtIndex={playAlbumTrackAtIndex}
            otherReleases={otherReleases}
            onReleaseClick={(nextRelease) => {
              if (!nextRelease) return;
              const nextTrack = {
                ...nextRelease,
                metadata: {
                  ...(nextRelease.metadata || {}),
                  releaseSlug: nextRelease.slug,
                  albumSlug: nextRelease.slug,
                },
              };
              openPlayerReleaseModal(nextTrack);
            }}
          />
        </ModalErrorBoundary>
      ) : (
        <ModalErrorBoundary
          stackId="player-release-single-modal"
          onClose={closePlayerReleaseModal}
          resetKey={release.slug || release.id || "player-release-single"}
        >
          <ImmersivePreviewModal
            single={release}
            releaseDetail={resolvedDetail?.slug === snapshot.releaseSlug ? resolvedDetail.value : null}
            access={access}
            open={snapshot.open}
            persistent
            userId={auth.currentUser?.id}
            isAdmin={Boolean(auth.sessionHydrated && auth.isAdmin)}
            onClose={closePlayerReleaseModal}
            onLibraryChange={handleLibraryChange}
            onAddToCart={addPersistentCartItem}
            onAddVinyl={addVinylToCart}
          />
        </ModalErrorBoundary>
      )}
    </div>
  );
}
