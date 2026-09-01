"use client";

import { useEffect, useRef } from "react";

/**
 * Dev-only render counter. Logs on mount and every 10th render to avoid console spam.
 * No-op in production.
 *
 * @param {string} label - Component name for log prefix
 */
export function useRenderTracker(label) {
  const countRef = useRef(0);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    countRef.current += 1;
    const n = countRef.current;
    if (n === 1 || n % 10 === 0) {
      console.debug(`[render] ${label}: #${n}`);
    }
  });
}
