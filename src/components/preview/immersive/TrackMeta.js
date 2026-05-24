"use client";

import { memo } from "react";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";

function TrackMeta({
  title,
  canStream,
  showPurchase,
  priceLabel,
  trackAccess,
  userId,
  single,
  isMobile,
  onLibraryChange,
  hasLyrics,
  onOpenGlyphs,
  palette,
}) {
  const statusLabel = canStream ? "FULL STREAM" : "PREVIEW TRACK";

  return (
    <div className="modal-immersive-meta">
      <h2
        className="modal-immersive-meta__title"
        style={{
          ["--modal-title-glow"]: palette?.primaryGlow || "rgba(0,220,210,0.35)",
        }}
      >
        {title}
      </h2>
      <div className="modal-immersive-meta__row">
        <span
          className="modal-immersive-meta__status"
          style={{ color: palette?.primaryCss || "#00dcd2" }}
        >
          {statusLabel}
          {showPurchase && priceLabel ? ` · ${priceLabel}` : ""}
        </span>
        <MusicAccessBadge access={trackAccess} label={trackAccess?.badge} compact />
        {userId ? (
          <MusicPlusButton
            track={single}
            userId={userId}
            access={trackAccess}
            isMobile={isMobile}
            onLibraryChange={onLibraryChange}
          />
        ) : null}
      </div>
      {hasLyrics ? (
        <div className="modal-immersive-meta__glyphs">
          <button type="button" className="modal-immersive-glyphs-btn" onClick={onOpenGlyphs}>
            GLYPHS
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default memo(TrackMeta);
