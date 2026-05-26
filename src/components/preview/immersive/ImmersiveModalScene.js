"use client";

import { memo, useMemo, useRef, useEffect, useState } from "react";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

function ImmersiveModalScene({
  palette,
  analyser = null,
  csMode = false,
  atmosphereLevel = 3,
  playbackState = null,
  previewOnly = false,
  currentTime = 0,
}) {
  const style = useMemo(() => paletteToCssVars(palette), [palette]);
  const orbARef = useRef(null);
  const orbBRef = useRef(null);
  const rafRef = useRef(null);

  const [csEntering, setCsEntering] = useState(false);
  const prevCsMode = useRef(csMode);

  useEffect(() => {
    if (prevCsMode.current === csMode) return undefined;
    prevCsMode.current = csMode;
    setCsEntering(true);
    const timer = window.setTimeout(() => setCsEntering(false), 1200);
    return () => window.clearTimeout(timer);
  }, [csMode]);

  const sceneClass = [
    "modal-immersive-scene",
    "immersive-layer",
    "immersive-layer--scene",
    csMode ? "modal-immersive-scene--cs" : "",
    csEntering ? "modal-immersive-scene--cs-entering" : "",
    playbackState === "ending" ? "modal-immersive-scene--ending" : "",
    previewOnly && currentTime >= 25 ? "modal-immersive-preview-closing" : "",
    atmosphereLevel === 1 ? "modal-immersive-scene--atmos-off" : "",
    atmosphereLevel === 2 ? "modal-immersive-scene--atmos-minimal" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!analyser) return undefined;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
      const mid = dataArray.slice(5, 20).reduce((a, b) => a + b, 0) / (15 * 255);

      if (orbARef.current) {
        orbARef.current.style.transform = `translate(${bass * 7}%, ${bass * 9}%) scale(${1 + bass * 0.15})`;
      }
      if (orbBRef.current) {
        orbBRef.current.style.transform = `translate(${-mid * 7}%, ${-mid * 6}%) scale(${1 + mid * 0.1})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser]);

  return (
    <div className={sceneClass} style={style} aria-hidden>
      <div className="modal-immersive-scene__gradient" />
      <div
        ref={orbARef}
        className="modal-immersive-scene__orb modal-immersive-scene__orb--a orb-a"
      />
      <div
        ref={orbBRef}
        className="modal-immersive-scene__orb modal-immersive-scene__orb--b orb-b"
      />
      <div className="modal-immersive-scene__orb modal-immersive-scene__orb--c orb-c" />
      <div className="modal-immersive-scene__rays">
        <span className="modal-immersive-scene__ray" />
        <span className="modal-immersive-scene__ray" />
        <span className="modal-immersive-scene__ray" />
      </div>
      <div className="modal-immersive-scene__scan sc-scan" />
      <div className="modal-immersive-scene__grain" />
    </div>
  );
}

export default memo(ImmersiveModalScene);
