"use client";

import { useCallback, useMemo } from "react";
import { useAuth, useEntitlementAccountState } from "@/context/AuthContext";
import { partitionLibraryByType } from "@/lib/music-access";
import {
  isCollectorLibraryItem,
  isPermanentLibraryItem,
  isStreamingLibraryItem,
} from "@/lib/library-ownership";

export function useMusicLibrary({ singles = [], albums = [], mixtapesAndEps = [] } = {}) {
  const {
    user,
    library,
    loading,
    refreshAccountState,
    refreshLibrary,
  } = useAuth();
  const accountState = useEntitlementAccountState();

  const refresh = useCallback(async () => {
    await refreshAccountState({ reason: "library:change", source: "useMusicLibrary" });
    await refreshLibrary({ reason: "library:change", source: "useMusicLibrary" });
  }, [refreshAccountState, refreshLibrary]);

  const recentlyPlayed = useMemo(() => {
    const progress = accountState?.mediaProgress || [];
    const slugToItem = new Map();
    [...singles, ...albums, ...mixtapesAndEps, ...library].forEach((item) => {
      if (item?.slug) slugToItem.set(item.slug, item);
    });
    return progress
      .filter((row) => row.mediaType === "audio" && row.slug)
      .map((row) => {
        const catalog = slugToItem.get(row.slug);
        // Spread the full catalog item so downstream consumers (toPlaybackTrack,
        // resolveTrackAccess) receive every field they need. Progress fields overlay last.
        return {
          ...(catalog || {}),
          slug: row.slug,
          positionSeconds: row.positionSeconds,
          durationSeconds: row.durationSeconds,
          completed: row.completed,
          lastPlayedAt: row.lastPlayedAt,
        };
      });
  }, [accountState?.mediaProgress, singles, albums, mixtapesAndEps, library]);

  const permanentLibrary = useMemo(
    () => (library || []).filter(isPermanentLibraryItem),
    [library]
  );

  const { ownedSingles, ownedAlbums, ownedMixtapes, ownedEps } = useMemo(
    () => partitionLibraryByType(permanentLibrary, { singles, albums, mixtapesAndEps }),
    [permanentLibrary, singles, albums, mixtapesAndEps]
  );

  const subscriptionItems = useMemo(
    () => (library || []).filter(isStreamingLibraryItem),
    [library]
  );

  const collectorItems = useMemo(
    () => (library || []).filter(isCollectorLibraryItem),
    [library]
  );

  const lastPlayed = recentlyPlayed[0] || null;

  return {
    user,
    library,
    accountState,
    loading,
    ownedSingles,
    ownedAlbums,
    ownedMixtapes,
    ownedEps,
    subscriptionItems,
    collectorItems,
    recentlyPlayed,
    lastPlayed,
    refresh,
  };
}
