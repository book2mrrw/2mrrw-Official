"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import * as store from "./recoveryStore";

export function useScrollRecovery() {
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => {
      store.save(`scroll:${pathname}`, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  const restoreScroll = useCallback((path) => {
    const y = store.load(`scroll:${path}`);
    if (y == null) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, Number(y) || 0);
      });
    });
  }, []);

  useEffect(() => {
    restoreScroll(pathname);
  }, [pathname, restoreScroll]);

  return { restoreScroll };
}
