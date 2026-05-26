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
  const timersRef = useRef([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  useEffect(() => {
    if (prevCsModeRef.current === csMode) return;
    prevCsModeRef.current = csMode;
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    clearTimers();
    setPhase(csMode ? "entering" : "exiting");
    timersRef.current.push(
      window.setTimeout(() => {
        setDisplaySrc(targetSrc);
        setDisplayType(targetType);
        prevTargetSrcRef.current = targetSrc;
      }, SWAP_MS)
    );
    timersRef.current.push(
      window.setTimeout(() => {
        setPhase("idle");
        isTransitioningRef.current = false;
      }, CS_TRANSITION_TOTAL_MS)
    );
    return () => {
      clearTimers();
      isTransitioningRef.current = false;
    };
  }, [csMode]);

  useEffect(() => {
    if (isTransitioningRef.current) return;
    if (prevTargetSrcRef.current === targetSrc) return;
    prevTargetSrcRef.current = targetSrc;
    setDisplaySrc(targetSrc);
    setDisplayType(targetType);
  }, [targetSrc, targetType]);

  useEffect(() => {
    return () => clearTimers();
  }, []);

  return {
    displaySrc,
    displayType,
    phase,
    artPhaseClass:
      phase === "entering"
        ? "modal-immersive-art--cs-entering"
        : phase === "exiting"
        ? "modal-immersive-art--cs-exiting"
        : "",
    sceneEntering: phase === "entering" || phase === "exiting",
    titlePulseClass: phase === "entering" ? "art-lbl--cs-pulse" : "",
  };
}
