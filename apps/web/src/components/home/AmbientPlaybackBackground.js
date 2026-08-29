"use client";

import { useLayoutEffect, useRef } from "react";
import { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { useAudioMediaPriority } from "@/hooks/useAudioMediaPriority";

const VIDEO_BLUR_DESKTOP = "blur(120px) saturate(1.2) brightness(0.15)";
const VIDEO_BLUR_MOBILE = "blur(72px) saturate(1.2) brightness(0.15)";

function AmbientVideoLayer({ src, style }) {
  const videoRef = useRef(null);
  const audioPriority = useAudioMediaPriority();

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (audioPriority.startupActive || !src) {
      if (!el.paused) el.pause();
      el.preload = "none";
      if (el.hasAttribute("src")) {
        el.removeAttribute("src");
        el.load();
      }
      return;
    }
    if (el.getAttribute("src") !== src) {
      el.src = src;
      el.preload = "auto";
      el.load();
    }
    if (!document.hidden && el.paused) el.play().catch(() => {});
  }, [audioPriority.startupActive, src]);

  return (
    <video
      ref={videoRef}
      loop
      muted
      playsInline
      preload="none"
      aria-hidden
      onError={(event) => { event.currentTarget.style.display = "none"; }}
      style={style}
    />
  );
}

export default function AmbientPlaybackBackground({ currentTrack, csMode, isMobile = false }) {
  if (!currentTrack?.cover) return null;

  const baseSrc = currentTrack.cover;
  const baseType = currentTrack.coverArtType || "image";
  const csSrc = currentTrack.csCover || null;
  const csType = currentTrack.csCoverType || "image";
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
    transition: "opacity 500ms ease",
    willChange: "transform, opacity",
  };

  const imageLayerStyle = {
    position: "fixed",
    inset: 0,
    zIndex: -1,
    pointerEvents: "none",
    backgroundSize: "cover",
    backgroundPosition: "center",
    filter: "blur(72px) brightness(0.32)",
    transform: "scale(1.08)",
    transition: "opacity 500ms ease",
    willChange: "transform, opacity",
  };

  return (
    <>
      {resolveCoverMediaType(baseSrc, baseType) === "video" ? (
        <AmbientVideoLayer
          src={baseSrc}
          style={{ ...mediaStyle, opacity: showCs ? 0 : 0.4 }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            ...imageLayerStyle,
            backgroundImage: `url(${baseSrc})`,
            opacity: showCs ? 0 : 0.45,
          }}
        />
      )}
      {csSrc &&
        (resolveCoverMediaType(csSrc, csType) === "video" ? (
          <AmbientVideoLayer
            src={csSrc}
            style={{ ...mediaStyle, opacity: showCs ? 0.4 : 0 }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              ...imageLayerStyle,
              backgroundImage: `url(${csSrc})`,
              opacity: showCs ? 0.45 : 0,
            }}
          />
        ))}
    </>
  );
}
