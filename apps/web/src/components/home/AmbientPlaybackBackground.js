"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { useAudioMediaPriority } from "@/hooks/useAudioMediaPriority";
import { VRM } from "@/lib/media/video-resource-manager";

// `baseSrc` and `csSrc` each render one of these, but only one is ever the
// currently-shown layer (opacity 0 vs 0.4/0.45, toggled by `showCs` below)
// -- `visible` makes that explicit instead of leaving both instances to
// decode/play regardless of which one is actually on screen.
//
// Two persistent video elements cross-fade between tracks: the current
// ambient keeps playing until the next track's has its first frame, so the
// background never goes blank or reloads in place. The next layer only
// loads (first frame) while hidden; at the swap one starts playing as the
// other pauses, so the decoder budget is unchanged. A new track's ambient
// waits for its audio's startup lease, never the one already on screen.
const CROSSFADE_MS = 500; // matches the layers' opacity transition

function AmbientVideoLayer({ src, visible, style }) {
  const layerA = useRef(null);
  const layerB = useRef(null);
  const [front, setFront] = useState(0);
  const frontRef = useRef(0);
  const audioPriority = useAudioMediaPriority();

  useEffect(() => {
    const els = [layerA.current, layerB.current].filter(Boolean);
    els.forEach((el) => VRM.register(el, VRM.PRIORITY_SYSTEM));
    return () => els.forEach((el) => {
      el.pause();
      VRM.unregister(el);
    });
  }, []);

  useLayoutEffect(() => {
    const layers = [layerA.current, layerB.current];
    const current = layers[frontRef.current];
    const next = layers[1 - frontRef.current];
    if (!current || !next) return undefined;
    const play = (el) => VRM.requestPlay(el, () => { if (el.paused) el.play().catch(() => {}); }, () => el.pause());
    const pause = (el) => { VRM.requestPause(el); if (!el.paused) el.pause(); };
    const show = (el) => { if (!visible || document.hidden) pause(el); else play(el); };

    if (!src) { pause(current); return undefined; }
    const currentSrc = current.getAttribute("src");
    if (currentSrc === src) { show(current); return undefined; }
    if (!currentSrc) {
      // Nothing on screen yet: the first ambient loads in place.
      if (audioPriority.startupActive) return undefined;
      current.src = src;
      current.preload = "auto";
      current.load();
      show(current);
      return undefined;
    }
    // A new track: the current ambient stays on screen while the next loads.
    show(current);
    if (audioPriority.startupActive) return undefined;
    if (next.getAttribute("src") !== src) {
      next.src = src;
      next.preload = "auto";
      next.load();
    }
    let released = null;
    const swap = () => {
      frontRef.current = 1 - frontRef.current;
      setFront(frontRef.current);
      show(next);
      pause(current);
      released = setTimeout(() => {
        current.removeAttribute("src"); // faded out: free its decoder
        current.load();
      }, CROSSFADE_MS + 100);
    };
    if (next.readyState >= 2) { swap(); return undefined; }
    next.addEventListener("loadeddata", swap, { once: true });
    return () => {
      next.removeEventListener("loadeddata", swap);
      if (released) clearTimeout(released);
    };
  }, [audioPriority.startupActive, src, visible]);

  const hideOnError = (event) => { event.currentTarget.style.display = "none"; };
  return (
    <>
      <video
        ref={layerA}
        loop
        muted
        playsInline
        preload="none"
        aria-hidden
        className="ambient-playback-media ambient-playback-media--video"
        onError={hideOnError}
        style={{ ...style, opacity: front === 0 ? style.opacity : 0 }}
      />
      <video
        ref={layerB}
        loop
        muted
        playsInline
        preload="none"
        aria-hidden
        className="ambient-playback-media ambient-playback-media--video"
        onError={hideOnError}
        style={{ ...style, opacity: front === 1 ? style.opacity : 0 }}
      />
    </>
  );
}

export default function AmbientPlaybackBackground({ currentTrack, csMode }) {
  if (!currentTrack?.cover) return null;

  const baseSrc = currentTrack.cover;
  const baseType = currentTrack.coverArtType || "image";
  const csSrc = currentTrack.csCover || null;
  const csType = currentTrack.csCoverType || "image";
  const showCs = Boolean(csMode && csSrc);
  // Beneath the galaxy (z-index -1), which stays over the blurred cover art.
  const mediaStyle = {
    position: "fixed",
    inset: 0,
    zIndex: -2,
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
    zIndex: -2,
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
