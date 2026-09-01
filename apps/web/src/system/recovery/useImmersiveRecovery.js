"use client";

import { useCallback } from "react";
import * as store from "./recoveryStore";

const IMMERSIVE_KEY = "immersive";

export function useImmersiveRecovery() {
  const saveImmersive = useCallback((open, trackId) => {
    store.save(IMMERSIVE_KEY, { open: Boolean(open), trackId: trackId || null });
  }, []);

  const restoreImmersive = useCallback((queueIds = [], onReopen) => {
    const saved = store.load(IMMERSIVE_KEY);
    if (!saved?.open || !saved.trackId) return;
    if (!queueIds.includes(saved.trackId)) return;
    onReopen?.(saved.trackId);
  }, []);

  return { saveImmersive, restoreImmersive };
}
