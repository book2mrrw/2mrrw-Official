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
    await refreshAccountState();
    await refreshLibrary();
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
        return {
          slug: row.slug,
          title: catalog?.title || row.slug,
          cover: catalog?.cover_art_url || catalog?.coverArtUrl || catalog?.cover || catalog?.coverArt,
          positionSeconds: row.positionSeconds,
          durationSeconds: row.durationSeconds,
          completed: row.completed,
          lastPlayedAt: row.lastPlayedAt,
          preview: catalog?.preview,
          audio: catalog?.audio || catalog?.full,
          src: catalog?.src,
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
