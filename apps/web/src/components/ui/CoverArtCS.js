"use client";

import CoverArt from "./CoverArt";
import { useCsCoverTransition } from "@/hooks/useCsCoverTransition";

export default function CoverArtCS({
  originalSrc,
  originalType,
  csSrc,
  csType,
  csOpacity = 0,
  csMode = false,
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
  const { displaySrc, displayType, artPhaseClass } = useCsCoverTransition({
    csMode,
    baseSrc: originalSrc,
    csSrc,
    baseType: originalType,
    csType: csType ?? "image",
  });

  const showCsOverlay = Boolean(csSrc && (csOpacity > 0 || csMode));
  const overlaySrc = csMode ? displaySrc : csSrc;
  const overlayType = csMode ? displayType : csType ?? "image";
  const coverClass = ["player-art-cover-layer", csMode ? artPhaseClass : ""]
    .filter(Boolean)
    .join(" ");

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
        src={originalSrc}
        type={originalType}
        width="100%"
        height="100%"
        borderRadius={borderRadius}
        className="player-art-cover-layer"
        style={{
          position: "absolute",
          inset: 0,
        }}
      />
      {showCsOverlay ? (
        <CoverArt
          src={overlaySrc}
          type={overlayType}
          width="100%"
          height="100%"
          borderRadius={borderRadius}
          className={coverClass}
          style={{
            position: "absolute",
            inset: 0,
            filter: "saturate(1.3) brightness(0.85)",
            opacity: csMode ? 1 : csOpacity,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
