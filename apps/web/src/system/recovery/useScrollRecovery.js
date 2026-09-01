"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import * as store from "./recoveryStore";

export function useScrollRecovery() {
  const pathname = usePathname();

  useEffect(() => {
    let scrollTimer = null;
    const onScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        store.save(`scroll:${pathname}`, window.scrollY);
      }, 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
    };
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
