"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { useAudioMediaPriority } from "@/hooks/useAudioMediaPriority";
import { VRM } from "@/lib/media/video-resource-manager";

// `baseSrc` and `csSrc` each render one of these, but only one is ever the
// currently-shown layer (opacity 0 vs 0.4/0.45, toggled by `showCs` below)
// -- `visible` makes that explicit instead of leaving both instances to
// decode/play regardless of which one is actually on screen.
function AmbientVideoLayer({ src, visible, style }) {
  const videoRef = useRef(null);
  const audioPriority = useAudioMediaPriority();

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    VRM.register(el, VRM.PRIORITY_SYSTEM);
    return () => {
      el.pause();
      VRM.unregister(el);
    };
  }, []);

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (audioPriority.startupActive || !src) {
      VRM.requestPause(el);
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
    if (!visible || document.hidden) {
      VRM.requestPause(el);
      if (!el.paused) el.pause();
      return;
    }
    VRM.requestPlay(
      el,
      () => { if (el.paused) el.play().catch(() => {}); },
      () => el.pause()
    );
  }, [audioPriority.startupActive, src, visible]);

  return (
    <video
      ref={videoRef}
      loop
      muted
      playsInline
      preload="none"
      aria-hidden
      className="ambient-playback-media ambient-playback-media--video"
      onError={(event) => { event.currentTarget.style.display = "none"; }}
      style={style}
    />
  );
}

export default function AmbientPlaybackBackground({ currentTrack, csMode }) {
  if (!currentTrack?.cover) return null;

  const baseSrc = currentTrack.cover;
  const baseType = currentTrack.coverArtType || "image";
  const csSrc = currentTrack.csCover || null;
  const csType = currentTrack.csCoverType || "image";
  const showCs = Boolean(csMode && csSrc);
  const mediaStyle = {
    position: "fixed",
    inset: 0,
    zIndex: -1,
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    objectFit: "cover",
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
    transform: "scale(1.08)",
    transition: "opacity 500ms ease",
    willChange: "transform, opacity",
  };

  return (
    <>
      {resolveCoverMediaType(baseSrc, baseType) === "video" ? (
        <AmbientVideoLayer
          src={baseSrc}
          visible={!showCs}
          style={{ ...mediaStyle, opacity: showCs ? 0 : 0.4 }}
        />
      ) : (
        <div
          aria-hidden
          className="ambient-playback-media ambient-playback-media--image"
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
            visible={showCs}
            style={{ ...mediaStyle, opacity: showCs ? 0.4 : 0 }}
          />
        ) : (
          <div
            aria-hidden
            className="ambient-playback-media ambient-playback-media--image"
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
