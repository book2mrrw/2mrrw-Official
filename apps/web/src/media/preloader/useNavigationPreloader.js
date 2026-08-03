"use client";

import { useCallback } from "react";
import { imagePipeline } from "@/media/imagePipeline";

const ROUTE_ARTWORK = {
  "/subscribe": "/images/albums/lovehz.jpg",
  "/vault": null,
};

export function useNavigationPreloader() {
  const onNavLinkHover = useCallback((pathname) => {
    const schedule =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback
        : (cb) => setTimeout(cb, 200);
    schedule(() => {
      const src = ROUTE_ARTWORK[pathname];
      if (src) imagePipeline.preload(src, "low");
    });
  }, []);

  return { onNavLinkHover };
}
