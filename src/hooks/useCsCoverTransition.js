"use client";

import { useEffect, useRef, useState } from "react";

export const CS_TRANSITION_TOTAL_MS = 1200;
const SWAP_MS = 200;

export function useCsCoverTransition({
  csMode,
  baseSrc,
  csSrc,
  baseType = "image",
  csType = "image",
}) {
  const targetSrc = csMode && csSrc ? csSrc : baseSrc;
  const targetType = csMode && csSrc ? csType : baseType;
  const [displaySrc, setDisplaySrc] = useState(targetSrc);
  const [displayType, setDisplayType] = useState(targetType);
  const [phase, setPhase] = useState("idle");

  const prevCsModeRef = useRef(csMode);
  const prevTargetSrcRef = useRef(targetSrc);
  const isTransitioningRef = useRef(false);

  // Handle CS MODE TOGGLE (csMode changed)
  useEffect(() => {
    if (prevCsModeRef.current === csMode) return;
    prevCsModeRef.current = csMode;

    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;

    setPhase(csMode ? "entering" : "exiting");
    const swapTimer = window.setTimeout(() => {
      setDisplaySrc(targetSrc);
      setDisplayType(targetType);
      prevTargetSrcRef.current = targetSrc;
    }, SWAP_MS);
    const endTimer = window.setTimeout(() => {
      setPhase("idle");
      isTransitioningRef.current = false;
    }, CS_TRANSITION_TOTAL_MS);
    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(endTimer);
      isTransitioningRef.current = false;
    };
  }, [csMode]); // ONLY watches csMode — nothing else

  // Handle SRC CHANGE when not transitioning
  // (catalog URL hydration, track change)
  useEffect(() => {
    if (isTransitioningRef.current) return;
    if (prevTargetSrcRef.current === targetSrc) return;
    prevTargetSrcRef.current = targetSrc;
    setDisplaySrc(targetSrc);
    setDisplayType(targetType);
  }, [targetSrc, targetType]); // Only fires when src actually changes

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
