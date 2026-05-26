"use client";

import { useEffect, useRef, useState } from "react";

export const CS_TRANSITION_TOTAL_MS = 1200;
const SWAP_MS = 200;

/**
 * 1.2s CS cover transition: blur-in 200ms → swap at 200ms → blur-out 400ms.
 * Returns phase classes for artwork, scene orb pulse, and title flash.
 */
export function useCsCoverTransition({
  csMode,
  baseSrc,
  csSrc,
  baseType = "image",
  csType = "image",
}) {
  const [displaySrc, setDisplaySrc] = useState(() => (csMode && csSrc ? csSrc : baseSrc));
  const [displayType, setDisplayType] = useState(() => (csMode && csSrc ? csType : baseType));
  const [phase, setPhase] = useState("idle");
  const prevCsMode = useRef(csMode);

  useEffect(() => {
    const targetSrc = csMode && csSrc ? csSrc : baseSrc;
    const targetType = csMode && csSrc ? csType : baseType;

    if (prevCsMode.current === csMode) {
      setDisplaySrc(targetSrc);
      setDisplayType(targetType);
      return undefined;
    }

    prevCsMode.current = csMode;
    setPhase(csMode ? "entering" : "exiting");

    const swapTimer = window.setTimeout(() => {
      setDisplaySrc(targetSrc);
      setDisplayType(targetType);
    }, SWAP_MS);

    const endTimer = window.setTimeout(() => setPhase("idle"), CS_TRANSITION_TOTAL_MS);

    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(endTimer);
    };
  }, [baseSrc, baseType, csMode, csSrc, csType]);

  const artPhaseClass =
    phase === "entering"
      ? "modal-immersive-art--cs-entering"
      : phase === "exiting"
        ? "modal-immersive-art--cs-exiting"
        : "";

  return {
    displaySrc,
    displayType,
    phase,
    artPhaseClass,
    sceneEntering: phase === "entering" || phase === "exiting",
    titlePulseClass: phase === "entering" ? "art-lbl--cs-pulse" : "",
  };
}
