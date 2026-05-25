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
}) {
  return (
    <section
      className={["modal-immersive-panel immersive-layer--panel", !isMobile ? "modal-immersive-panel--scroll" : ""]
        .filter(Boolean)
        .join(" ")}
      style={panelStyle}
    >
      <TrackMeta
        title={single.title}
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
      />

      <PreviewPlayerControls
        palette={palette}
        compact={isMobile}
        canStream={canStream}
      />

      <ModalActionButtons
        showPurchase={showPurchase}
        showGift={isAdmin}
        priceLabel={priceLabel}
        palette={palette}
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
