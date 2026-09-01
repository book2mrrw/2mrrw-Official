"use client";

import { useMemo } from "react";
import { useCoverPalette, paletteToCssVars, DEFAULT_PALETTE } from "@/hooks/useCoverPalette";

export function playerPaletteToCssVars(palette) {
  const base = paletteToCssVars(palette);
  const p = palette || DEFAULT_PALETTE;
  return {
    ...base,
    ["--player-accent"]: p.primaryCss,
    ["--player-accent-glow"]: p.primaryGlow,
    ["--player-accent-muted"]: p.primaryMuted,
    ["--player-ambient-glow"]: p.ambientTint,
    ["--player-edge-glow"]: p.edgeGlow,
  };
}

export function usePlayerAmbience(coverSrc, coverType = "image") {
  const palette = useCoverPalette(coverSrc, coverType);
  const cssVars = useMemo(() => playerPaletteToCssVars(palette), [palette]);
  return { palette, cssVars };
}
