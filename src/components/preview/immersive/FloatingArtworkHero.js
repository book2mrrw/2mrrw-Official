"use client";

import { memo } from "react";
import CoverArt from "@/components/ui/CoverArt";
import { useCsCoverTransition } from "@/hooks/useCsCoverTransition";
import { isMotionCoverMedia } from "@/hooks/useCoverPalette";

/**
 * ONE primary artwork surface — sole video/img decode for cover motion.
 * No layoutId (avoids shared-element recursion with dock player).
 */
function FloatingArtworkHero({
  coverSrc,
  coverType,
  baseCoverSrc,
  baseCoverType,
  csCoverSrc,
  csCoverType,
  csMode = false,
  coverArtKey,
  title,
  palette,
  isMobile,
}) {
  const baseSrc = baseCoverSrc ?? coverSrc;
  const baseType = baseCoverType ?? coverType;
  const { displaySrc, displayType, artPhaseClass } = useCsCoverTransition({
    csMode,
    baseSrc,
    csSrc: csCoverSrc,
    baseType,
    csType: csCoverType ?? "image",
  });

  const animated = palette?.animated ?? isMotionCoverMedia(displaySrc, displayType);
  const artClass = [
    "modal-immersive-art",
    animated ? "" : "modal-immersive-art--pulse",
    isMobile ? "modal-immersive-art--mobile" : "",
    artPhaseClass,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`immersive-layer immersive-layer--hero ${artClass}`}>
      <div className="immersive-mp4-world">
        <CoverArt
          key={`${coverArtKey}:${displaySrc}:${csMode ? "cs" : "base"}`}
          src={displaySrc}
          type={displayType}
          alt={title}
          width="100%"
          height="100%"
          className="modal-immersive-art__cover"
          style={isMobile ? undefined : { objectFit: "contain", objectPosition: "center top" }}
        />
      </div>
      <div className="modal-immersive-art__sheen" aria-hidden />
    </div>
  );
}

export default memo(FloatingArtworkHero);
