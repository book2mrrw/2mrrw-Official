"use client";

import { useCallback, useMemo } from "react";
import { LISTENING_KEYS, readListeningRail } from "@/lib/listening-history";

/**
 * Scalable listening rails — merges server mediaProgress with localStorage stubs.
 * UI can consume continueListening, recentlyPlayedRail, recentlyAddedRail.
 */
export function useListeningHistory({ accountState, singles = [], albums = [] } = {}) {
  const slugToItem = useMemo(() => {
    const map = new Map();
    [...singles, ...albums].forEach((item) => {
      if (item?.slug) map.set(item.slug, item);
    });
    return map;
  }, [singles, albums]);

  const enrichRow = useCallback(
    (row) => {
      if (!row?.slug) return null;
      const catalog = slugToItem.get(row.slug);
      return {
        slug: row.slug,
        title: catalog?.title || row.title || row.slug,
        cover: catalog?.cover || catalog?.cover_art_url || row.cover || null,
        positionSeconds: row.positionSeconds ?? 0,
        durationSeconds: row.durationSeconds ?? 0,
        completed: Boolean(row.completed),
        lastPlayedAt: row.lastPlayedAt || row.addedAt || null,
        preview: catalog?.preview,
        audio: catalog?.audio || catalog?.full,
        src: catalog?.src,
      };
    },
    [slugToItem]
  );

  const serverProgress = useMemo(() => {
    const progress = accountState?.mediaProgress || [];
    return progress
      .filter((row) => row.mediaType === "audio" && row.slug)
      .map(enrichRow)
      .filter(Boolean);
  }, [accountState?.mediaProgress, enrichRow]);

  const localRecentlyPlayed = useMemo(() => {
    if (typeof window === "undefined") return [];
    return readListeningRail(LISTENING_KEYS.recentlyPlayed).map(enrichRow).filter(Boolean);
  }, [enrichRow]);

  const localContinue = useMemo(() => {
    if (typeof window === "undefined") return [];
    return readListeningRail(LISTENING_KEYS.continue).map(enrichRow).filter(Boolean);
  }, [enrichRow]);

  const localRecentlyAdded = useMemo(() => {
    if (typeof window === "undefined") return [];
    return readListeningRail(LISTENING_KEYS.recentlyAdded).map(enrichRow).filter(Boolean);
  }, [enrichRow]);

  const recentlyPlayedRail = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const row of [...serverProgress, ...localRecentlyPlayed]) {
      if (seen.has(row.slug)) continue;
      seen.add(row.slug);
      merged.push(row);
    }
    return merged.slice(0, 12);
  }, [serverProgress, localRecentlyPlayed]);

  const continueListening = useMemo(() => {
    const candidate =
      recentlyPlayedRail.find((r) => !r.completed && r.positionSeconds > 0) ||
      localContinue[0] ||
      recentlyPlayedRail[0] ||
      null;
    return candidate;
  }, [recentlyPlayedRail, localContinue]);

  const recentlyAddedRail = useMemo(() => localRecentlyAdded.slice(0, 8), [localRecentlyAdded]);

  return {
    continueListening,
    recentlyPlayedRail,
    recentlyAddedRail,
    hasListeningData: recentlyPlayedRail.length > 0 || recentlyAddedRail.length > 0,
  };
}
