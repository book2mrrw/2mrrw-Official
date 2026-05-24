"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import CoverArt from "@/components/ui/CoverArt";
import CoverArtCS from "@/components/ui/CoverArtCS";
import { PLAYER_LAYOUT_ID } from "@/lib/player/constants";

function PlayerArtwork({
  baseCoverUrl,
  baseCoverType = "image",
  csCoverUrl = null,
  csCoverType = "image",
  csOpacity = 0,
  csMode = false,
  size,
  borderRadius = 12,
  isPlaying = false,
  layoutId = PLAYER_LAYOUT_ID,
  className = "",
  style,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onClick,
  role,
  tabIndex,
  "aria-label": ariaLabel,
}) {
  const dim = typeof size === "number" ? size : undefined;
  const glowClass = [
    "player-art-glow",
    isPlaying ? "player-art-glow--playing" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const frame = (
    <motion.div
      layoutId={layoutId}
      className={glowClass}
      style={{
        width: size,
        height: size,
        borderRadius,
        ...style,
      }}
    >
      {csCoverUrl || csOpacity > 0 ? (
        <CoverArtCS
          originalSrc={baseCoverUrl}
          originalType={baseCoverType}
          csSrc={csCoverUrl}
          csType={csCoverType}
          csOpacity={csOpacity}
          isLocked={csMode}
          width="100%"
          height="100%"
          borderRadius={borderRadius}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onClick}
          role={role}
          tabIndex={tabIndex}
          aria-label={ariaLabel}
        />
      ) : (
        <CoverArt
          src={baseCoverUrl}
          type={baseCoverType}
          width={dim || "100%"}
          height={dim || "100%"}
          borderRadius={borderRadius}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onClick}
          role={role}
          tabIndex={tabIndex}
          aria-label={ariaLabel}
        />
      )}
    </motion.div>
  );

  return frame;
}

export default memo(PlayerArtwork);
