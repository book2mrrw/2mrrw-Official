"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Prevents overlapping navigation/transition operations.
 */
export function useTransitionGuard() {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const lockRef = useRef(false);

  const beginTransition = useCallback(async (fn) => {
    if (lockRef.current) return { ok: false, reason: "busy" };
    lockRef.current = true;
    setIsTransitioning(true);
    try {
      const result = await fn?.();
      return { ok: true, result };
    } finally {
      lockRef.current = false;
      setIsTransitioning(false);
    }
  }, []);

  const endTransition = useCallback(() => {
    lockRef.current = false;
    setIsTransitioning(false);
  }, []);

  return { isTransitioning, beginTransition, endTransition };
}
