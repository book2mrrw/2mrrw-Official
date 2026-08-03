"use client";

import { useEffect, useRef } from "react";

/**
 * AbortController that auto-aborts on unmount and when deps change.
 * @param {unknown[]} deps
 */
export function useAbortController(deps = []) {
  const controllerRef = useRef(null);

  if (!controllerRef.current) {
    controllerRef.current = new AbortController();
  }

  useEffect(() => {
    const prev = controllerRef.current;
    controllerRef.current = new AbortController();
    prev?.abort();
    return () => {
      controllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return controllerRef.current;
}
