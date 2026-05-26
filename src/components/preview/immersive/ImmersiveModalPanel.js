"use client";

import { memo } from "react";
import TrackMeta from "@/components/preview/immersive/TrackMeta";
import PreviewPlayerControls from "@/components/preview/immersive/PreviewPlayerControls";
import ModalActionButtons from "@/components/preview/immersive/ModalActionButtons";

const CLOSE_BTN_STYLE = {
  background: "none",
  border: "none",
  color: "#555",
  cursor: "pointer",
  fontSize: 12,
  marginTop: 2,
};

function ImmersiveModalPanel({
  isMobile,
  panelStyle,
  single,
  trackAccess,
  canStream,
  showPurchase,
  priceLabel,
  userId,
  onLibraryChange,
  hasLyrics,
  onOpenGlyphs,
  palette,
  isAdmin,
  onAddToCart,
  onGift,
  onAddVinyl,
  onClose,
  previewEndedCTA = null,
}) {
  const previewOnly = Boolean(trackAccess && !trackAccess.canStream);
  const panelClass = [
    "modal-immersive-panel",
    "immersive-layer--panel",
    isMobile ? "modal-immersive-panel--mobile" : "modal-immersive-panel--scroll",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section key={single?.slug || "panel"} className={panelClass} style={panelStyle}>
      <TrackMeta
        title={single.title}
        artist={single.artist || "2MRRW"}
        releaseType={single.type || single.releaseType || "Single"}
        canStream={canStream}
        showPurchase={showPurchase}
        priceLabel={priceLabel}
        trackAccess={trackAccess}
        userId={userId}
        single={single}
        isMobile={isMobile}
        onLibraryChange={onLibraryChange}
        hasLyrics={hasLyrics}
        onOpenGlyphs={onOpenGlyphs}
        palette={palette}
        hideAccessBadge={isMobile}
      />

      {!isMobile ? (
        <PreviewPlayerControls
          palette={palette}
          compact={false}
          canStream={canStream}
          previewOnly={previewOnly}
        />
      ) : null}

      {previewEndedCTA}

      {canStream && trackAccess?.owned ? (
        <div className="modal-immersive-owner-panel" role="status">
          <span className="modal-immersive-owner-panel__check" aria-hidden>
            ✓
          </span>
          <div className="modal-immersive-owner-panel__copy">
            <span className="modal-immersive-owner-panel__title">You own this track</span>
            <span className="modal-immersive-owner-panel__sub">Full quality stream unlocked</span>
          </div>
        </div>
      ) : null}

      <ModalActionButtons
        showPurchase={showPurchase}
        showGift={isAdmin}
        priceLabel={priceLabel}
        palette={palette}
        isMobile={isMobile}
        canStream={canStream}
        owned={Boolean(trackAccess?.owned)}
        onAddToCart={onAddToCart}
        onGift={onGift}
      />

      {showPurchase ? (
        <button type="button" className="modal-immersive-vinyl-link" onClick={onAddVinyl}>
          + Add Vinyl – $47.99 (Optional)
        </button>
      ) : null}

      {!isMobile ? (
        <button type="button" onClick={onClose} style={CLOSE_BTN_STYLE}>
          Close
        </button>
      ) : null}
    </section>
  );
}

export default memo(ImmersiveModalPanel);
