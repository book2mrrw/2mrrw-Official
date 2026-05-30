"use client";

import { useCallback, useEffect, useRef } from "react";
import * as store from "./recoveryStore";

const PLAYBACK_KEY = "playback";

export function usePlaybackRecovery({ queue, queueIndex, getCurrentTime, hasStarted, onRestore }) {
  const saveTimerRef = useRef(null);

  const persist = useCallback(() => {
    if (!queue?.length) return;
    store.save(PLAYBACK_KEY, {
      queueIds: queue.map((t) => t.id || t.slug).filter(Boolean),
      queueIndex,
      currentTime: typeof getCurrentTime === "function" ? getCurrentTime() : 0,
      savedAt: Date.now(),
    });
  }, [queue, queueIndex, getCurrentTime]);

  useEffect(() => {
    persist();
  }, [queue, queueIndex, persist]);

  useEffect(() => {
    if (!hasStarted) return undefined;
    saveTimerRef.current = setInterval(persist, 5000);
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    };
  }, [hasStarted, persist]);

  const restore = useCallback(() => {
    const saved = store.load(PLAYBACK_KEY);
    if (!saved?.queueIds?.length) return null;
    onRestore?.({
      queueIds: saved.queueIds,
      queueIndex: saved.queueIndex ?? 0,
      currentTime: saved.currentTime ?? 0,
      autoPlay: false,
    });
    return saved;
  }, [onRestore]);

  return { persist, restore };
}
