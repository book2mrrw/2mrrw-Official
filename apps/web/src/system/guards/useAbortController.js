"use client";

import { useEffect, useMemo } from "react";

/**
 * AbortController that auto-aborts on unmount and when deps change.
 * @param {unknown} dependencyKey
 */
export function useAbortController(dependencyKey) {
  // The controller is the resource for this dependency generation. Creating it
  // during memoization avoids mutable-ref reads during render; cleanup aborts
  // precisely the generation that the completed render committed.
  const controller = useMemo(() => {
    void dependencyKey;
    return new AbortController();
  }, [dependencyKey]);

  useEffect(() => {
    return () => controller.abort();
  }, [controller]);

  return controller;
}
