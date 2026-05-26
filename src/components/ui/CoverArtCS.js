"use client";

import CoverArt from "./CoverArt";
import { useCsCoverTransition } from "@/hooks/useCsCoverTransition";

export default function CoverArtCS({
  originalSrc,
  originalType,
  csSrc,
  csType,
  csOpacity = 0,
  isLocked = false,
  width,
  height,
  borderRadius,
  onClick,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  style,
  className,
  role,
  tabIndex,
  "aria-label": ariaLabel,
}) {
  const csMode = isLocked || csOpacity >= 1;
  const { displaySrc, displayType, artPhaseClass } = useCsCoverTransition({
    csMode: Boolean(csMode && csSrc),
    baseSrc: originalSrc,
    csSrc,
    baseType: originalType,
    csType: csType ?? "image",
  });

  const showCsLayer = Boolean(csSrc && (csOpacity > 0 || isLocked));
  const coverClass = ["player-art-cover-layer", artPhaseClass].filter(Boolean).join(" ");

  return (
    <div
      className={className}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        width,
        height,
        borderRadius,
        overflow: "hidden",
        ...style,
      }}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <CoverArt
        src={showCsLayer ? displaySrc : originalSrc}
        type={showCsLayer ? displayType : originalType}
        width="100%"
        height="100%"
        borderRadius={borderRadius}
        className={coverClass}
        style={{
          position: "absolute",
          inset: 0,
          filter: showCsLayer && csMode ? "saturate(1.3) brightness(0.85)" : undefined,
          opacity: showCsLayer && !isLocked ? csOpacity : 1,
        }}
      />
    </div>
  );
}
