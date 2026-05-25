"use client";

import { useCallback, useEffect, useState } from "react";
import { useAbortController } from "@/system/guards/useAbortController";

/**
 * Re-hydrates recovered queue track IDs into full playback metadata.
 * Partial hydration is allowed — proceeds with whatever resolves.
 */
export function useTrackHydration(trackIds = []) {
  const [tracks, setTracks] = useState([]);
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydratedCount, setHydratedCount] = useState(0);
  const controller = useAbortController([trackIds.join(",")]);

  const hydrate = useCallback(async (ids, signal) => {
    if (!ids?.length) {
      setTracks([]);
      setHydratedCount(0);
      return [];
    }
    setIsHydrating(true);
    try {
      const qs = encodeURIComponent(ids.join(","));
      const res = await fetch(`/api/catalog/hydrate?ids=${qs}`, {
        credentials: "include",
        cache: "no-store",
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Hydration failed");
      const resolved = Array.isArray(data.tracks) ? data.tracks : [];
      setTracks(resolved);
      setHydratedCount(data.hydratedCount ?? resolved.filter((t) => t.title && t.src).length);
      if (data.failedIds?.length) {
        try {
          const { telemetry } = await import("@/system/telemetry");
          data.failedIds.forEach((id) => {
            telemetry?.log?.({
              type: "playback.recovery.hydration_failed",
              trackId: id,
            });
          });
        } catch {
          /* optional */
        }
      }
      return resolved;
    } catch (err) {
      if (err?.name === "AbortError") return [];
      try {
        const { telemetry } = await import("@/system/telemetry");
        telemetry?.log?.({
          type: "playback.recovery.hydration_failed",
          error: err?.message || "unknown",
        });
      } catch {
        /* optional */
      }
      const fallback = ids.map((id) => ({
        id,
        slug: id,
        title: "Restored",
        src: `/api/library/stream?slug=${encodeURIComponent(id)}`,
      }));
      setTracks(fallback);
      setHydratedCount(0);
      return fallback;
    } finally {
      setIsHydrating(false);
    }
  }, []);

  useEffect(() => {
    if (!trackIds?.length) {
      setTracks([]);
      setHydratedCount(0);
      return undefined;
    }
    void hydrate(trackIds, controller.signal);
    return () => controller.abort();
  }, [trackIds, hydrate, controller]);

  return { tracks, isHydrating, hydratedCount, hydrate };
}
