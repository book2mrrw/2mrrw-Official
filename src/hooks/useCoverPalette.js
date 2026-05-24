"use client";

import { useEffect, useState } from "react";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";

const FALLBACK_PRIMARY = [0, 220, 210];
const FALLBACK_SECONDARY = [100, 72, 180];

export const DEFAULT_PALETTE = {
  primary: FALLBACK_PRIMARY,
  secondary: FALLBACK_SECONDARY,
  primaryCss: "rgb(0, 220, 210)",
  secondaryCss: "rgb(100, 72, 180)",
  primaryGlow: "rgba(0, 220, 210, 0.42)",
  secondaryGlow: "rgba(100, 72, 180, 0.28)",
  primaryMuted: "rgba(0, 220, 210, 0.14)",
  secondaryMuted: "rgba(100, 72, 180, 0.12)",
};

function rgbToCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbToGlow([r, g, b], alpha = 0.42) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildPalette(primary, secondary) {
  return {
    primary,
    secondary,
    primaryCss: rgbToCss(primary),
    secondaryCss: rgbToCss(secondary),
    primaryGlow: rgbToGlow(primary, 0.44),
    secondaryGlow: rgbToGlow(secondary, 0.3),
    primaryMuted: rgbToGlow(primary, 0.14),
    secondaryMuted: rgbToGlow(secondary, 0.1),
  };
}

/**
 * Extract dominant colors from cover art for modal ambience (colorthief).
 */
export function useCoverPalette(coverSrc, coverType = "image") {
  const [palette, setPalette] = useState(DEFAULT_PALETTE);

  useEffect(() => {
    if (!coverSrc || coverType === "video") {
      setPalette(DEFAULT_PALETTE);
      return undefined;
    }

    const url = resolveAbsoluteArtworkUrl(coverSrc);
    if (!url || url.startsWith("blob:")) {
      setPalette(DEFAULT_PALETTE);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const { default: ColorThief } = await import("colorthief");
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.src = url;

        await new Promise((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("cover load failed"));
        });

        if (cancelled) return;

        const thief = new ColorThief();
        const primary = thief.getColor(img);
        const swatches = thief.getPalette(img, 6) || [];
        const secondary =
          swatches.find(
            (c) =>
              Math.abs(c[0] - primary[0]) + Math.abs(c[1] - primary[1]) + Math.abs(c[2] - primary[2]) >
              48
          ) ||
          swatches[1] ||
          primary;

        if (!cancelled) setPalette(buildPalette(primary, secondary));
      } catch {
        if (!cancelled) setPalette(DEFAULT_PALETTE);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coverSrc, coverType]);

  return palette;
}
