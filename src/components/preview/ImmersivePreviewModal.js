"use client";

import { useMemo, useState, memo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { extractLrcFromRelease } from "@/lib/lrc";
import { useCoverPalette, paletteToCssVars } from "@/hooks/useCoverPalette";
import { usePlayerBodyState } from "@/lib/player/usePlayerBodyState";
import { PlayerAtmosphere } from "@/components/player/ImmersivePlayerEngine";
import ModalShell from "@/components/modal/ModalShell";
import AmbientArtworkBackground from "@/components/preview/immersive/AmbientArtworkBackground";
import TrackMeta from "@/components/preview/immersive/TrackMeta";
import PreviewPlayerControls from "@/components/preview/immersive/PreviewPlayerControls";
import ModalActionButtons from "@/components/preview/immersive/ModalActionButtons";
import FloatingViewMore from "@/components/preview/immersive/FloatingViewMore";
import PreviewModalPlayer from "@/components/preview/PreviewModalPlayer";
import CoverArt from "@/components/ui/CoverArt";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import GiftButton from "@/components/gifts/GiftButton";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { ImmersiveErrorBoundary } from "@/system/errors";
import { ImmersiveModalSkeleton } from "@/ui/skeletons";
import { useMediaTiming } from "@/system/performance";

const DRAWER_COLLAPSE_THRESHOLD = 72;
const MODAL_DISMISS_THRESHOLD = 56;

const LAYER_VISIBLE = {
  opacity: 1,
  pointerEvents: "auto",
  visibility: "visible",
  position: "relative",
  width: "100%",
  height: "100%",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const LAYER_HIDDEN = {
  opacity: 0,
  pointerEvents: "none",
  visibility: "hidden",
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

function viewLayerStyle(active) {
  return active ? LAYER_VISIBLE : LAYER_HIDDEN;
}

const GLYPHS_BTN_STYLE = {
  background: "rgba(162,89,255,0.12)",
  border: "1px solid rgba(162,89,255,0.35)",
  color: "#d4b8ff",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 2.5,
  textTransform: "uppercase",
  padding: "8px 16px",
  borderRadius: 20,
  cursor: "pointer",
};

const CART_BTN_STYLE = {
  width: "100%",
  padding: "12px 0",
  background: "#1f1f1f",
  color: "white",
  border: "1px solid #333",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const CLOSE_BTN_STYLE = {
  background: "none",
  border: "none",
  color: "#555",
  cursor: "pointer",
  fontSize: 12,
  marginTop: 2,
};

function ImmersivePreviewModal({
  single,
  releaseDetail,
  isMobile,
  onClose,
  onAddToCart,
  onAddVinyl,
  trackAccess = null,
  userId = null,
  isAdmin = false,
  onGift,
  onLibraryChange,
}) {
  useRenderTracker("ImmersivePreviewModal");
  const { onImmersiveRenderStart, onImmersiveRenderEnd } = useMediaTiming();
  const [contentReady, setContentReady] = useState(false);
  const [viewMoreOpen, setViewMoreOpen] = useState(false);
  const [glyphsOpen, setGlyphsOpen] = useState(false);

  const release = releaseDetail || single;
  const editorial = useMemo(() => getReleaseEditorial(release), [release]);
  const creditRows = useMemo(() => getCreditsDisplayRows(editorial), [editorial]);
  const lrcText = useMemo(() => {
    const lrc = extractLrcFromRelease(release);
    if (lrc?.trim()) return lrc;
    const track = Array.isArray(release?.tracks) ? release.tracks[0] : null;
    return track?.lyricsText || track?.lyrics_text || track?.lyrics || "";
  }, [release]);
  const hasLyrics = Boolean(lrcText?.trim());

  usePlayerBodyState({ modalOpen: true });

  useEffect(() => {
    onImmersiveRenderStart();
    setContentReady(false);
    const t = requestAnimationFrame(() => {
      setContentReady(true);
      onImmersiveRenderEnd();
    });
    return () => cancelAnimationFrame(t);
  }, [single?.id, release?.slug, onImmersiveRenderStart, onImmersiveRenderEnd]);

  const closeModal = useCallback(() => {
    setViewMoreOpen(false);
    setGlyphsOpen(false);
    onClose();
  }, [onClose]);

  const handleCloseClick = useCallback(
    (e) => {
      e.stopPropagation();
      closeModal();
    },
    [closeModal]
  );

  const collapseDrawer = useCallback(() => setViewMoreOpen(false), []);

  const handleOverlayClick = useCallback(() => {
    if (glyphsOpen) {
      setGlyphsOpen(false);
      return;
    }
    closeModal();
  }, [glyphsOpen, closeModal]);

  const handleDrawerDragEnd = useCallback((_e, info) => {
    if (info.offset.y > DRAWER_COLLAPSE_THRESHOLD || info.velocity.y > 420) {
      collapseDrawer();
    }
  }, [collapseDrawer]);

  const handleModalDismissDragEnd = useCallback(
    (_e, info) => {
      if (info.offset.y > MODAL_DISMISS_THRESHOLD || info.velocity.y > 400) {
        closeModal();
      }
    },
    [closeModal]
  );

  const coverSrc = single?.video || single?.cover || null;
  const coverType = single?.coverArtType || (single?.video ? "video" : "image");
  const coverArtKey = single?.slug || single?.id || "preview";
  const palette = useCoverPalette(coverSrc, coverType);
  const paletteVars = paletteToCssVars(palette);

  const canStream = Boolean(trackAccess?.canStream);
  const showPurchase = trackAccess ? Boolean(trackAccess.showCart) : true;
  const priceLabel =
    single?.price != null && showPurchase ? `$${Number(single.price).toFixed(2)}` : null;

  const handleAddToCart = useCallback(() => {
    onAddToCart(single);
    closeModal();
  }, [onAddToCart, single, closeModal]);

  const handleViewMoreToggle = useCallback(() => {
    setGlyphsOpen(false);
    setViewMoreOpen((o) => !o);
  }, []);

  const handleOpenGlyphs = useCallback(() => {
    setViewMoreOpen(false);
    setGlyphsOpen(true);
  }, []);

  const handleCloseGlyphs = useCallback(() => setGlyphsOpen(false), []);

  const handleAddVinyl = useCallback(() => {
    onAddVinyl(single);
    closeModal();
  }, [onAddVinyl, single, closeModal]);

  const handleGift = useCallback(() => onGift?.(single), [onGift, single]);

  const desktopShellStyle = useMemo(
    () => ({
      width: "min(420px, 96vw)",
      maxWidth: "100%",
      maxHeight: "94vh",
      boxShadow: `0 0 48px ${palette.primaryGlow}, 0 24px 80px rgba(0,0,0,0.65)`,
    }),
    [palette.primaryGlow]
  );

  const desktopStageStyle = useMemo(
    () => ({
      position: "relative",
      width: "100%",
      height: "min(52vh, 520px)",
      flexShrink: 0,
      overflow: "hidden",
      background: "#000",
    }),
    []
  );

  const desktopCoverStyle = useMemo(
    () => ({
      objectFit: "contain",
      objectPosition: "center top",
      pointerEvents: "none",
      position: "relative",
      zIndex: 2,
    }),
    []
  );

  const desktopPanelStyle = useMemo(
    () => ({
      padding: "16px 22px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      pointerEvents: glyphsOpen ? "none" : "auto",
    }),
    [glyphsOpen]
  );

  const desktopTitleStyle = useMemo(
    () => ({ fontSize: 20, fontWeight: 800, letterSpacing: 1, lineHeight: 1.2 }),
    []
  );

  const desktopMetaRowStyle = useMemo(
    () => ({ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }),
    []
  );

  const desktopStatusStyle = useMemo(
    () => ({ fontSize: 11, opacity: 0.45, letterSpacing: 1 }),
    []
  );

  const desktopGlyphsRowStyle = useMemo(
    () => ({ display: "flex", justifyContent: "flex-end" }),
    []
  );

  const vinylBtnStyle = useMemo(
    () => ({
      width: "100%",
      padding: "12px 0",
      background: "#0a0a0a",
      color: palette.primaryCss,
      border: `1px solid ${palette.primaryCss}`,
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: "bold",
    }),
    [palette.primaryCss]
  );

  const mobilePanelStyle = useMemo(
    () => ({ opacity: glyphsOpen ? 0 : 1, pointerEvents: glyphsOpen ? "none" : "auto" }),
    [glyphsOpen]
  );

  const mobileLayerStyle = useMemo(() => viewLayerStyle(isMobile), [isMobile]);
  const desktopLayerStyle = useMemo(() => viewLayerStyle(!isMobile), [isMobile]);

  if (!single) return null;

  return (
    <ImmersiveErrorBoundary onExitImmersive={onClose}>
    <>
      <PlayerAtmosphere open />
      <ModalShell
        stackId="immersive-preview"
        isMobile={isMobile}
        paletteVars={paletteVars}
        onOverlayClick={handleOverlayClick}
        onDragEnd={handleModalDismissDragEnd}
        onClose={onClose}
        desktopStyle={desktopShellStyle}
      >
        {!contentReady ? <ImmersiveModalSkeleton isMobile={isMobile} /> : null}
        <div key="preview-mobile-layer" style={mobileLayerStyle} aria-hidden={!isMobile}>
          <button
            type="button"
            className="modal-immersive-sheet-handle"
            aria-label="Close preview"
            onClick={handleCloseClick}
          />

          <button
            type="button"
            className="preview-modal-close-btn modal-immersive-close"
            aria-label="Close preview"
            onClick={handleCloseClick}
          >
            ✕
          </button>

          <section className="modal-immersive-stage">
            <AmbientArtworkBackground src={coverSrc} type={coverType} palette={palette} />

            <div className={`modal-immersive-art${palette.animated ? "" : " modal-immersive-art--pulse"}`}>
              <CoverArt
                key={coverArtKey}
                src={coverSrc}
                type={coverType}
                alt={single.title}
                width="100%"
                height="100%"
                className="modal-immersive-art__cover"
              />
              <div className="modal-immersive-art__sheen" aria-hidden />
            </div>

            <FloatingViewMore
              open={viewMoreOpen}
              onToggle={handleViewMoreToggle}
              onCollapse={collapseDrawer}
              isMobile
              creditRows={creditRows}
              handleDrawerDragEnd={handleDrawerDragEnd}
              palette={palette}
            />

            <GlyphLyricsPanel
              open={glyphsOpen}
              lrcText={lrcText}
              isMobile
              onClose={handleCloseGlyphs}
            />
          </section>

          <section className="modal-immersive-panel" style={mobilePanelStyle}>
            <TrackMeta
              title={single.title}
              canStream={canStream}
              showPurchase={showPurchase}
              priceLabel={priceLabel}
              trackAccess={trackAccess}
              userId={userId}
              single={single}
              isMobile
              onLibraryChange={onLibraryChange}
              hasLyrics={hasLyrics}
              onOpenGlyphs={handleOpenGlyphs}
              palette={palette}
            />

            <PreviewPlayerControls palette={palette} compact />

            <ModalActionButtons
              showPurchase={showPurchase}
              showGift={isAdmin}
              priceLabel={priceLabel}
              palette={palette}
              onAddToCart={handleAddToCart}
              onGift={handleGift}
            />

            {showPurchase ? (
              <button
                type="button"
                className="modal-immersive-vinyl-link"
                onClick={handleAddVinyl}
              >
                + Add Vinyl – $47.99 (Optional)
              </button>
            ) : null}
          </section>
        </div>

        <div key="preview-desktop-layer" style={desktopLayerStyle} aria-hidden={isMobile}>
          <motion.div
            key="preview-desktop-stage"
            initial={{ opacity: 0.85, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, boxShadow: `0 0 36px ${palette.primaryGlow}` }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
            style={desktopStageStyle}
          >
            <AmbientArtworkBackground src={coverSrc} type={coverType} palette={palette} />
            <CoverArt
              key={coverArtKey}
              src={coverSrc}
              type={coverType}
              alt={single.title}
              width="100%"
              height="100%"
              style={desktopCoverStyle}
            />
            <FloatingViewMore
              open={viewMoreOpen}
              onToggle={handleViewMoreToggle}
              onCollapse={collapseDrawer}
              isMobile={false}
              creditRows={creditRows}
              handleDrawerDragEnd={handleDrawerDragEnd}
              palette={palette}
            />
            <GlyphLyricsPanel
              open={glyphsOpen}
              lrcText={lrcText}
              isMobile={false}
              onClose={handleCloseGlyphs}
            />
          </motion.div>

          <motion.div
            key="preview-desktop-panel"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: glyphsOpen ? 0 : 1, y: glyphsOpen ? 10 : 0 }}
            transition={{ delay: glyphsOpen ? 0 : 0.42, duration: 0.35 }}
            className="modal-immersive-panel modal-immersive-panel--scroll"
            style={desktopPanelStyle}
          >
            <div className="hero-title-glow" style={desktopTitleStyle}>
              {single.title}
            </div>
            <div style={desktopMetaRowStyle}>
              <div style={desktopStatusStyle}>
                {canStream ? "FULL STREAM" : "PREVIEW TRACK"}
                {showPurchase && priceLabel ? ` · ${priceLabel}` : ""}
              </div>
              <MusicAccessBadge access={trackAccess} label={trackAccess?.badge} compact />
              {userId ? (
                <MusicPlusButton
                  track={single}
                  userId={userId}
                  access={trackAccess}
                  isMobile={false}
                  onLibraryChange={onLibraryChange}
                />
              ) : null}
            </div>

            {hasLyrics ? (
              <div style={desktopGlyphsRowStyle}>
                <button type="button" onClick={handleOpenGlyphs} style={GLYPHS_BTN_STYLE}>
                  GLYPHS
                </button>
              </div>
            ) : null}

            <PreviewModalPlayer compact={false} />

            {isAdmin ? <GiftButton onClick={handleGift} style={{ width: "100%", marginBottom: 8 }} /> : null}
            {showPurchase ? (
              <button type="button" onClick={handleAddToCart} style={CART_BTN_STYLE}>
                Add to Cart{priceLabel ? ` – ${priceLabel}` : ""}
              </button>
            ) : null}
            {showPurchase ? (
              <button type="button" onClick={handleAddVinyl} style={vinylBtnStyle}>
                + Add Vinyl – $47.99 (Optional)
              </button>
            ) : null}
            <button type="button" onClick={closeModal} style={CLOSE_BTN_STYLE}>
              Close
            </button>
          </motion.div>
        </div>
      </ModalShell>
    </>
    </ImmersiveErrorBoundary>
  );
}

export default memo(ImmersivePreviewModal);
