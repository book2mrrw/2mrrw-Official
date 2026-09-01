"use client";

import { useCallback, useEffect } from "react";

export function useResync(resync, { enabled = true } = {}) {
  const trigger = useCallback((reason = "manual") => {
    if (typeof resync === "function") resync(reason);
  }, [resync]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleOnline = () => trigger("online");
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [enabled, trigger]);

  return trigger;
}
