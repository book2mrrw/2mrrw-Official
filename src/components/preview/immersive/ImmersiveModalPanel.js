"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAudioPlayer } from "@/context/AudioContext";
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
  const previewOnly = Boolean(trackAccess && !trackAccess.canStream);
  const { playbackState } = useAudioPlayer();
  const [previewEndedSignal, setPreviewEndedSignal] = useState(0);

  useEffect(() => {
    const onPreviewEndedEvent = (event) => {
      const slug = event?.detail?.slug;
      if (!slug || slug === single?.slug) {
        setPreviewEndedSignal((n) => n + 1);
      }
    };
    window.addEventListener("preview:ended", onPreviewEndedEvent);
    return () => window.removeEventListener("preview:ended", onPreviewEndedEvent);
  }, [single?.slug]);

  const previewEnded =
    previewOnly && (previewEndedSignal > 0 || playbackState === "ended_preview");

  const handleUnlockCart = useCallback(() => {
    onAddToCart?.();
  }, [onAddToCart]);

  return (
    <section
      key={single?.slug || "panel"}
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
        previewOnly={previewOnly}
      />

      {previewEnded && showPurchase ? (
        <div
          className="modal-immersive-preview-unlock"
          role="status"
          style={{
            marginTop: 8,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid rgba(0,255,255,0.25)",
            background: "rgba(0,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "#aaa", lineHeight: 1.5 }}>
            Preview ended. Unlock the full track or subscribe for unlimited streaming.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleUnlockCart}
              style={{
                flex: 1,
                minWidth: 120,
                padding: "10px 14px",
                background: "#0a0a0a",
                color: "#00ffff",
                border: "1px solid #00ffff",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {priceLabel ? `Unlock · ${priceLabel}` : "Unlock full track"}
            </button>
            <Link
              href="/subscribe"
              style={{
                flex: 1,
                minWidth: 120,
                padding: "10px 14px",
                background: "#a259ff",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Subscribe
            </Link>
          </div>
        </div>
      ) : null}

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
