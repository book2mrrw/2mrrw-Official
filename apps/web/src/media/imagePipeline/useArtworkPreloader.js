"use client";

import { useEffect } from "react";
import { imagePipeline } from "./ImagePipeline";

/**
 * Preload artwork URLs for upcoming queue/carousel items.
 * @param {Array<{ cover?: string, coverArtType?: string }>} items
 * @param {{ priority?: string }} [options]
 */
export function useArtworkPreloader(items = [], options = {}) {
  const { priority = "high" } = options;

  useEffect(() => {
    if (!items?.length) return;
    for (const item of items.slice(0, 3)) {
      if (item?.cover) imagePipeline.preload(item.cover, priority, { coverArtType: item.coverArtType });
    }
  }, [items, priority]);
}
