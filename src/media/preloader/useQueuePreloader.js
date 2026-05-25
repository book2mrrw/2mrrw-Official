"use client";

import { useEffect, useRef } from "react";
import { preloadTrack, cancelAll } from "./MediaPreloader";
import * as budget from "./preloadBudget";

/**
 * Preloads next N queue items when queue position changes.
 */
export function useQueuePreloader(queue = [], queueIndex = -1) {
  const prevIdsRef = useRef([]);

  useEffect(() => {
    const upcoming = queue.slice(queueIndex + 1, queueIndex + 3);
    const upcomingIds = upcoming.map((t) => t?.id || t?.slug).filter(Boolean);

    for (const id of prevIdsRef.current) {
      if (!upcomingIds.includes(id)) {
        budget.releasePreload("audio", id);
        budget.releasePreload("artwork", id);
      }
    }
    prevIdsRef.current = upcomingIds;

    for (const track of upcoming) {
      const id = track?.id || track?.slug;
      if (!id) continue;
      preloadTrack(id, track.src, track.cover || track.baseCover, track.coverArtType);
    }

    return () => {
      if (queueIndex < 0) cancelAll();
    };
  }, [queue, queueIndex]);
}
