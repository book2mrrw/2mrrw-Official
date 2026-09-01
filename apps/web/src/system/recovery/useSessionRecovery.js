"use client";

import { useEffect, useState } from "react";
import * as store from "./recoveryStore";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";

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
        } catch (error) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "RECOVERY_HYDRATE_FAILED",
            command: "RECOVERY_HYDRATE",
            error,
            context: {
              queueSize: playback.queueIds.length,
              visibility: typeof document !== "undefined" ? document.visibilityState : null,
              source: "session_recovery",
            },
          });
        }
        if (!cancelled) {
          window.dispatchEvent(
            new CustomEvent("2mrrw:playback-recovery", {
              detail: { ...playback, tracks: hydratedTracks },
            })
          );
        }
        // Stream session bookkeeping runs via after() in the stream route on the actual
        // play request — no need to block recovery dispatch waiting for a pre-warm that:
        //   1. provided no benefit on serverless (per-lambda in-process cache is not shared)
        //   2. did not include trackSlug so was broken for album tracks anyway
        //   3. cleared active sessions which could race with recovery-triggered playback
      }
      if (!cancelled) setIsRecovering(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { isRecovering };
}
