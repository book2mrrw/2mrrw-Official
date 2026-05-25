"use client";

import { memo } from "react";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

function TrackMeta({
  title,
  artist = "2MRRW",
  releaseType = "Single",
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
  hideAccessBadge = false,
}) {
  const statusLabel = canStream ? "Full Track" : "30 sec preview";
  const metaClass = ["modal-immersive-meta", isMobile ? "modal-immersive-meta--mobile" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={metaClass} style={paletteToCssVars(palette)}>
      <div className="modal-immersive-meta__head">
        <h2 className="modal-immersive-meta__title">{title}</h2>
        <p className="modal-immersive-meta__artist">{artist}</p>
        <p className="modal-immersive-meta__sub">
          {releaseType} · {statusLabel}
          {showPurchase && priceLabel && !isMobile ? ` · ${priceLabel}` : ""}
        </p>
      </div>
      {!isMobile ? (
        <div className="modal-immersive-meta__row">
          <span className="modal-immersive-meta__status">
            {canStream ? "FULL STREAM" : "PREVIEW TRACK"}
          </span>
          {!hideAccessBadge ? (
            <MusicAccessBadge access={trackAccess} label={trackAccess?.badge} compact />
          ) : null}
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
      ) : (
        <div className="modal-immersive-meta__row modal-immersive-meta__row--mobile">
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
      )}
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
