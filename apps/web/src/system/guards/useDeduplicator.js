"use client";

import { useCallback, useRef } from "react";

/**
 * Prevents identical concurrent in-flight operations.
 */
export function useDeduplicator() {
  const inflightRef = useRef(new Set());

  const isInflight = useCallback((key) => inflightRef.current.has(key), []);

  const track = useCallback((key) => {
    if (!key) return false;
    if (inflightRef.current.has(key)) return false;
    inflightRef.current.add(key);
    return true;
  }, []);

  const release = useCallback((key) => {
    if (key) inflightRef.current.delete(key);
  }, []);

  return { isInflight, track, release };
}
