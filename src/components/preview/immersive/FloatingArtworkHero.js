"use client";

import { memo } from "react";
import CoverArt from "@/components/ui/CoverArt";
import { isMotionCoverMedia } from "@/hooks/useCoverPalette";

/**
 * ONE primary artwork surface — sole video/img decode for cover motion.
 * No layoutId (avoids shared-element recursion with dock player).
 */
function FloatingArtworkHero({
  coverSrc,
  coverType,
  coverArtKey,
  title,
  palette,
  isMobile,
}) {
  const animated = palette?.animated ?? isMotionCoverMedia(coverSrc, coverType);
  const artClass = `modal-immersive-art${animated ? "" : " modal-immersive-art--pulse"}`;

  return (
    <div className={`immersive-layer immersive-layer--hero ${artClass}`}>
      <div className="immersive-mp4-world">
        <CoverArt
          key={coverArtKey}
          src={coverSrc}
          type={coverType}
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
