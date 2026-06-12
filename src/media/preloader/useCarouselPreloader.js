"use client";

import { useEffect } from "react";
import { imagePipeline } from "@/media/imagePipeline";

export function useCarouselPreloader(items = [], activeIndex = 0) {
  useEffect(() => {
    const neighbors = [activeIndex - 1, activeIndex + 1]
      .filter((i) => i >= 0 && i < items.length)
      .map((i) => items[i]);
    for (const item of neighbors) {
      if (item?.cover) imagePipeline.preload(item.cover, "normal", { coverArtType: item.coverArtType });
    }
  }, [items, activeIndex]);
}
