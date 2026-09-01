"use client";

import { useCallback, useRef } from "react";

/**
 * Rejects async results when a newer request version is active.
 */
export function useStaleGuard() {
  const versionRef = useRef(0);

  const nextVersion = useCallback(() => {
    versionRef.current += 1;
    return versionRef.current;
  }, []);

  const isStale = useCallback((captured) => captured !== versionRef.current, []);

  const bump = useCallback(() => {
    versionRef.current += 1;
  }, []);

  return { nextVersion, isStale, bump, currentVersion: () => versionRef.current };
}
