"use client";

import CoverArt from "./CoverArt";

const CROSSFADE_MS = 300;

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
        style={{ position: "absolute", inset: 0 }}
      />
      {csSrc && (
        <CoverArt
          src={csSrc}
          type={csType}
          width="100%"
          height="100%"
          borderRadius={borderRadius}
          style={{
            position: "absolute",
            inset: 0,
            opacity: csOpacity,
            filter: "saturate(1.3) brightness(0.85)",
            transition: isLocked ? "none" : `opacity ${CROSSFADE_MS}ms ease`,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
