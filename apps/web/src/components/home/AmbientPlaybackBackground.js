"use client";

import CoverArt from "@/components/ui/CoverArt";

const VIDEO_BLUR_DESKTOP = "blur(120px) saturate(1.2) brightness(0.15)";
const VIDEO_BLUR_MOBILE = "blur(72px) saturate(1.2) brightness(0.15)";

export default function AmbientPlaybackBackground({ currentTrack, csMode, isMobile = false }) {
  if (!currentTrack?.cover) return null;

  const baseSrc = currentTrack.cover;
  const baseType = currentTrack.coverArtType || "image";
  const basePoster = currentTrack.baseCover || (baseType === "image" ? baseSrc : null);
  const csSrc = currentTrack.csCover || null;
  const csType = currentTrack.csCoverType || "image";
  const csPoster = currentTrack.csBaseCover || (csType === "image" ? csSrc : basePoster);
  const showCs = Boolean(csMode && csSrc);
  const videoFilter = isMobile ? VIDEO_BLUR_MOBILE : VIDEO_BLUR_DESKTOP;

  const mediaStyle = {
    position: "fixed",
    inset: 0,
    zIndex: -1,
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: videoFilter,
    transform: "scale(1.08)",
    transition: "opacity 500ms ease",
    willChange: "transform, opacity",
  };

  return (
    <>
      <CoverArt
        src={baseSrc}
        baseCover={basePoster || undefined}
        type={baseType}
        alt=""
        width="100%"
        height="100%"
        loadPriority="high"
        style={{ ...mediaStyle, opacity: showCs ? 0 : 0.42 }}
      />
      {csSrc ? (
        <CoverArt
          src={csSrc}
          baseCover={csPoster || undefined}
          type={csType}
          alt=""
          width="100%"
          height="100%"
          loadPriority="normal"
          style={{ ...mediaStyle, opacity: showCs ? 0.42 : 0 }}
        />
      ) : null}
    </>
  );
}
