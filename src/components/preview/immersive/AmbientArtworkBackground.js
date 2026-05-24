"use client";

import { memo } from "react";
import CoverArt from "@/components/ui/CoverArt";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";

function AmbientArtworkBackground({ src, type, alt, palette }) {
  const imageUrl = type === "video" ? null : resolveAbsoluteArtworkUrl(src);

  return (
    <div className="modal-immersive-ambient" aria-hidden>
      {imageUrl ? (
        <div
          className="modal-immersive-ambient__blur"
          style={{
            backgroundImage: `url(${imageUrl})`,
            ["--modal-accent-glow"]: palette?.primaryGlow || "rgba(0,220,210,0.35)",
            ["--modal-secondary-glow"]: palette?.secondaryGlow || "rgba(100,72,180,0.22)",
          }}
        />
      ) : (
        <CoverArt
          src={src}
          type={type}
          alt=""
          width="100%"
          height="100%"
          className="modal-immersive-ambient__media"
        />
      )}
      <div
        className="modal-immersive-ambient__wash"
        style={{
          background: `radial-gradient(ellipse 90% 70% at 50% 18%, ${palette?.primaryMuted || "rgba(0,220,210,0.12)"} 0%, transparent 62%),
            radial-gradient(ellipse 80% 55% at 82% 88%, ${palette?.secondaryMuted || "rgba(100,72,180,0.1)"} 0%, transparent 58%),
            linear-gradient(180deg, rgba(4,4,6,0.15) 0%, rgba(4,4,6,0.72) 58%, rgba(2,2,4,0.94) 100%)`,
        }}
      />
      <div className="modal-immersive-ambient__noise" />
    </div>
  );
}

export default memo(AmbientArtworkBackground);
