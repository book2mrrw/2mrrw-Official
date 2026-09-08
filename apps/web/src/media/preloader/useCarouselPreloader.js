"use client";

import { useEffect } from "react";
import { imagePipeline } from "@/media/imagePipeline";

export function useCarouselPreloader(items = [], activeIndex = 0) {
  useEffect(() => {
    if (!items.length) return;
    const ordered = [activeIndex, (activeIndex + 1) % items.length, (activeIndex - 1 + items.length) % items.length];
    const immediate = new Set(ordered);
    for (const index of ordered) {
      const item = items[index];
      if (item?.cover) void imagePipeline.preload(item.cover, "critical", { coverArtType: "image" });
    }
    for (let index = 0; index < items.length; index += 1) {
      if (immediate.has(index)) continue;
      const item = items[index];
      if (item?.cover) void imagePipeline.preload(item.cover, "high", { coverArtType: "image" });
    }
  }, [items, activeIndex]);
}
