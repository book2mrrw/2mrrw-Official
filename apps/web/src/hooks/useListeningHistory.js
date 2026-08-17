"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getListeningKeys,
  LISTENING_HISTORY_EVENT,
  readListeningRail,
} from "@/lib/listening-history";

/**
 * Scalable listening rails — merges server mediaProgress with localStorage stubs.
 * UI can consume continueListening, recentlyPlayedRail, recentlyAddedRail.
 */
export function useListeningHistory({ accountState, singles = [], albums = [], userId } = {}) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return undefined;
    const handler = (event) => {
      if (!event.detail?.userId || event.detail.userId === userId) {
        setRevision((value) => value + 1);
      }
    };
    window.addEventListener(LISTENING_HISTORY_EVENT, handler);
    return () => window.removeEventListener(LISTENING_HISTORY_EVENT, handler);
  }, [userId]);

  const slugToItem = useMemo(() => {
    const map = new Map();
    [...singles, ...albums].forEach((item) => {
      if (item?.slug) map.set(item.slug, item);
    });
    // Also index individual album track slugs so album tracks show cover art in recently played
    albums.forEach((album) => {
      const trackList = album?.tracks || album?.trackTitles || [];
      trackList.forEach((track) => {
        if (!track || typeof track === "string") return;
        const slug = track.slug;
        if (!slug || map.has(slug)) return;
        map.set(slug, {
          ...track,
          cover: track.cover || track.cover_art || album.cover || album.cover_art || album.cover_url || null,
          albumSlug: album.slug,
          albumTitle: album.title,
          type: album.type || album.releaseType || "album",
        });
      });
    });
    return map;
  }, [singles, albums]);

  const enrichRow = useCallback(
    (row) => {
      if (!row?.slug) return null;
      const catalog = slugToItem.get(row.slug);
      return {
        // Spread the full catalog item first so toPlaybackTrack receives every field it
        // needs (type, albumSlug, trackSlug, metadata, price, releaseType, etc.).
        // Progress-specific fields then overlay only the fields that belong to this row.
        ...(catalog || {}),
        slug: row.slug,
        positionSeconds: row.positionSeconds ?? 0,
        durationSeconds: row.durationSeconds ?? 0,
        completed: Boolean(row.completed),
        lastPlayedAt: row.lastPlayedAt || row.addedAt || null,
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

  const listeningKeys = useMemo(() => getListeningKeys(userId), [userId]);

  const localRecentlyPlayed = useMemo(() => {
    if (!listeningKeys) return [];
    return readListeningRail(listeningKeys.recentlyPlayed).map(enrichRow).filter(Boolean);
  }, [enrichRow, listeningKeys, revision]);

  const localContinue = useMemo(() => {
    if (!listeningKeys) return [];
    return readListeningRail(listeningKeys.continue).map(enrichRow).filter(Boolean);
  }, [enrichRow, listeningKeys, revision]);

  const localRecentlyAdded = useMemo(() => {
    if (!listeningKeys) return [];
    return readListeningRail(listeningKeys.recentlyAdded).map(enrichRow).filter(Boolean);
  }, [enrichRow, listeningKeys, revision]);

  const recentlyPlayedRail = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const row of [...localRecentlyPlayed, ...serverProgress]) {
      if (seen.has(row.slug)) continue;
      seen.add(row.slug);
      merged.push(row);
    }
    return merged.slice(0, 12);
  }, [serverProgress, localRecentlyPlayed]);

  const continueListening = useMemo(() => {
    const candidate =
      localContinue.find((r) => !r.completed && r.positionSeconds > 0) ||
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
