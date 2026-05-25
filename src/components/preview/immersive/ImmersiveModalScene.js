"use client";

import { memo, useMemo } from "react";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

/**
 * CSS-only scene atmosphere (orbs, rays, grain) inside the modal stage.
 * Palette comes from useCoverPalette — no duplicate theme catalog.
 */
function ImmersiveModalScene({ palette }) {
  const style = useMemo(() => paletteToCssVars(palette), [palette]);

  return (
    <div className="modal-immersive-scene immersive-layer immersive-layer--scene" style={style} aria-hidden>
      <div className="modal-immersive-scene__gradient" />
      <div className="modal-immersive-scene__orb modal-immersive-scene__orb--a" />
      <div className="modal-immersive-scene__orb modal-immersive-scene__orb--b" />
      <div className="modal-immersive-scene__orb modal-immersive-scene__orb--c" />
      <div className="modal-immersive-scene__rays">
        <span className="modal-immersive-scene__ray" />
        <span className="modal-immersive-scene__ray" />
        <span className="modal-immersive-scene__ray" />
      </div>
      <div className="modal-immersive-scene__scan" />
      <div className="modal-immersive-scene__grain" />
    </div>
  );
}

export default memo(ImmersiveModalScene);
