"use client";

import { useEffect, useState } from "react";
import * as store from "./recoveryStore";
import { refreshSignedUrlsForQueue } from "./signedUrlRefresher";

/**
 * Orchestrates session recovery on mount.
 * Playback restore is delegated to AudioProvider via window event to avoid circular deps.
 */
export function useSessionRecovery() {
  const [isRecovering, setIsRecovering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const playback = store.load("playback");
      if (playback?.queueIds?.length) {
        const tracks = playback.queueIds.map((id) => ({ id, slug: id }));
        await refreshSignedUrlsForQueue(tracks);
        window.dispatchEvent(
          new CustomEvent("2mrrw:playback-recovery", {
            detail: playback,
          })
        );
      }
      if (!cancelled) setIsRecovering(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { isRecovering };
}
