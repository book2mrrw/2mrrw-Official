"use client";

import { useEffect, useState } from "react";
import { useCoverPalette } from "@/media/visualEngine";
import { imagePipeline } from "./ImagePipeline";

export function useArtworkLoader(src, options = {}) {
  const { coverArtType = "image", priority = "normal" } = options;
  const [isLoading, setIsLoading] = useState(Boolean(src));
  const [isError, setIsError] = useState(false);
  const palette = useCoverPalette(src, coverArtType);

  useEffect(() => {
    if (!src) {
      setIsLoading(false);
      setIsError(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);
    imagePipeline
      .load(src, priority, { coverArtType })
      .then(() => {
        if (!cancelled) setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
          setIsError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [src, coverArtType, priority]);

  return {
    src: isError ? null : src,
    isLoading,
    isError,
    palette,
  };
}
