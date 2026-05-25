"use client";

import { memo } from "react";
import AmbientArtworkBackground from "@/components/preview/immersive/AmbientArtworkBackground";

/**
 * Palette gradients + static blur haze — no video decode (hero owns motion MP4).
 * Site vignette (PlayerAtmosphere) stays outside the stage to avoid transform stacking traps.
 */
function AtmosphericBackgroundLayer({ src, type, palette }) {
  return (
    <div className="immersive-layer immersive-layer--atmosphere" aria-hidden>
      <AmbientArtworkBackground src={src} type={type} palette={palette} />
    </div>
  );
}

export default memo(AtmosphericBackgroundLayer);
