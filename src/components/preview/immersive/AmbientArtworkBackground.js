"use client";

import { memo, useMemo } from "react";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import { isMotionCoverMedia } from "@/hooks/useCoverPalette";

/**
 * Palette-only ambience for motion/video — ArtworkLayer owns the sole media decode.
 */
function AmbientArtworkBackground({ src, type, palette }) {
  const animated = palette?.animated ?? isMotionCoverMedia(src, type);
  const imageUrl = !animated ? resolveAbsoluteArtworkUrl(src) : null;

  const washStyle = useMemo(
    () => ({
      background: `radial-gradient(ellipse 92% 72% at 50% 16%, ${palette?.gradientTop || "rgba(0,220,210,0.22)"} 0%, transparent 58%),
      radial-gradient(ellipse 78% 58% at 18% 82%, ${palette?.secondaryMuted || "rgba(100,72,180,0.1)"} 0%, transparent 55%),
      radial-gradient(ellipse 70% 50% at 88% 78%, ${palette?.ambientTint || "rgba(0,220,210,0.18)"} 0%, transparent 52%),
      linear-gradient(180deg, rgba(4,4,6,0.12) 0%, rgba(4,4,6,0.68) 56%, rgba(2,2,4,0.94) 100%)`,
    }),
    [palette?.gradientTop, palette?.secondaryMuted, palette?.ambientTint]
  );

  return (
    <div
      className={`modal-immersive-ambient${animated ? " modal-immersive-ambient--animated" : " modal-immersive-ambient--static"}`}
      aria-hidden
    >
      {imageUrl ? (
        <div
          className="modal-immersive-ambient__blur modal-immersive-ambient__blur--static"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      ) : null}

      <div
        className={`modal-immersive-ambient__pulse${animated ? " modal-immersive-ambient__pulse--motion" : ""}`}
        aria-hidden
      />

      <div className="modal-immersive-ambient__wash" style={washStyle} />
      <div className="modal-immersive-ambient__noise" />
    </div>
  );
}

export default memo(AmbientArtworkBackground);
