"use client";

import { useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { partitionLibraryByType } from "@/lib/music-access";

export function useMusicLibrary({ singles = [], albums = [] } = {}) {
  const {
    user,
    library,
    accountState,
    loading,
    refreshAccountState,
    refreshLibrary,
  } = useAuth();

  const refresh = useCallback(async () => {
    await refreshAccountState();
    await refreshLibrary();
  }, [refreshAccountState, refreshLibrary]);

  const recentlyPlayed = useMemo(() => {
    const progress = accountState?.mediaProgress || [];
    const slugToItem = new Map();
    [...singles, ...albums, ...library].forEach((item) => {
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
  }, [accountState?.mediaProgress, singles, albums, library]);

  const { ownedSingles, ownedAlbums } = useMemo(
    () => partitionLibraryByType(library, { singles, albums }),
    [library, singles, albums]
  );

  const subscriptionItems = useMemo(
    () =>
      (library || []).filter(
        (item) => item.membershipAccess || item.source === "membership"
      ),
    [library]
  );

  const collectorItems = useMemo(
    () =>
      (library || []).filter(
        (item) => item.collectorAccess || item.source === "collector_access"
      ),
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
    subscriptionItems,
    collectorItems,
    recentlyPlayed,
    lastPlayed,
    refresh,
  };
}
