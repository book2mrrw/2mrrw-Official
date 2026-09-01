"use client";

import { useEffect } from "react";
import {
  isBlackscreenTraceEnabled,
  logBlackscreenMount,
  logBlackscreenUnmount,
} from "@/lib/diagnostics/blackscreen-trace";

/**
 * Phase 13 — mount/unmount counter for black-screen diagnostics.
 * @param {string} site
 */
export function useBlackscreenMountTrace(site) {
  useEffect(() => {
    if (!isBlackscreenTraceEnabled()) return undefined;
    logBlackscreenMount(site);
    return () => {
      logBlackscreenUnmount(site);
    };
  }, [site]);
}
