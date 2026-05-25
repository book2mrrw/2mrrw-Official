"use client";

import { useEffect, useState } from "react";
import * as store from "./recoveryStore";
import { refreshSignedUrlsForQueue } from "./signedUrlRefresher";

/**
 * Orchestrates session recovery on mount:
 * playback snapshot → signed URL refresh → track metadata hydration → dispatch.
 * Hydration uses /api/catalog/hydrate (see useTrackHydration); partial results are OK.
 */
export function useSessionRecovery() {
  const [isRecovering, setIsRecovering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const playback = store.load("playback");
      if (playback?.queueIds?.length) {
        let hydratedTracks = playback.queueIds.map((id) => ({ id, slug: id }));
        try {
          const qs = encodeURIComponent(playback.queueIds.join(","));
          const res = await fetch(`/api/catalog/hydrate?ids=${qs}`, {
            credentials: "include",
            cache: "no-store",
          });
          const data = await res.json();
          if (res.ok && Array.isArray(data.tracks) && data.tracks.length) {
            hydratedTracks = data.tracks;
          }
        } catch {
          /* fallback IDs preserved */
        }
        await refreshSignedUrlsForQueue(hydratedTracks);
        if (!cancelled) {
          window.dispatchEvent(
            new CustomEvent("2mrrw:playback-recovery", {
              detail: { ...playback, tracks: hydratedTracks },
            })
          );
        }
      }
      if (!cancelled) setIsRecovering(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { isRecovering };
}
