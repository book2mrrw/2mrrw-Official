"use client";

import { memo, useMemo } from "react";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

/**
 * CSS-only frame energy derived from cover palette (no media elements).
 */
function AmbientLightingLayer({ palette }) {
  const style = useMemo(
    () => ({
      ...paletteToCssVars(palette),
      background: `radial-gradient(ellipse 55% 42% at 50% 72%, ${palette?.primaryGlow || "rgba(0,220,210,0.2)"} 0%, transparent 68%),
        radial-gradient(ellipse 40% 28% at 82% 18%, ${palette?.secondaryMuted || "rgba(100,72,180,0.12)"} 0%, transparent 55%)`,
    }),
    [palette]
  );

  return <div className="immersive-layer immersive-layer--lighting" style={style} aria-hidden />;
}

export default memo(AmbientLightingLayer);
