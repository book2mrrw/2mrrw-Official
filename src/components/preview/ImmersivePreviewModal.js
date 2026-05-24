"use client";

import { useMemo, useState, memo, useCallback } from "react";
import { motion } from "framer-motion";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { extractLrcFromRelease } from "@/lib/lrc";
import { useCoverPalette } from "@/hooks/useCoverPalette";
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

const SPRING_SOFT = { type: "spring", stiffness: 320, damping: 34 };
const SPRING_EXIT = { type: "spring", stiffness: 380, damping: 36 };
const OVERLAY_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.28 },
};
const SHEET_UP = {
  initial: { y: "100%", scale: 0.96, opacity: 0.55 },
  animate: { y: 0, scale: 1, opacity: 1 },
  exit: { y: "100%", scale: 0.97, opacity: 0.45 },
  transition: SPRING_SOFT,
};
const MODAL_CENTER = {
  initial: { opacity: 0, scale: 0.88, y: 24 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, y: 12 },
  transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
};
const DRAWER_COLLAPSE_THRESHOLD = 72;
const MODAL_DISMISS_THRESHOLD = 56;

function ImmersivePreviewModal({
  single,
  releaseDetail,
  isMobile,
  onClose,
  audioRef,
  onAddToCart,
  onAddVinyl,
  trackAccess = null,
  userId = null,
  isAdmin = false,
  onGift,
  onLibraryChange,
}) {
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

  const shellVariant = isMobile ? SHEET_UP : MODAL_CENTER;

  const closeModal = useCallback(() => {
    setViewMoreOpen(false);
    setGlyphsOpen(false);
    onClose();
  }, [onClose]);

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

  if (!single) return null;

  const canStream = Boolean(trackAccess?.canStream);
  const showPurchase = trackAccess ? Boolean(trackAccess.showCart) : true;
  const priceLabel =
    single?.price != null && showPurchase ? `$${Number(single.price).toFixed(2)}` : null;

  const coverSrc = single.video || single.cover;
  const coverType = single.coverArtType || (single.video ? "video" : "image");
  const palette = useCoverPalette(coverSrc, coverType);

  const paletteVars = {
    ["--modal-accent"]: palette.primaryCss,
    ["--modal-accent-secondary"]: palette.secondaryCss,
    ["--modal-accent-glow"]: palette.primaryGlow,
    ["--modal-secondary-glow"]: palette.secondaryGlow,
  };

  const handleAddToCart = () => {
    onAddToCart(single);
    closeModal();
  };

  if (isMobile) {
    return (
      <motion.div
        key="preview-overlay"
        {...OVERLAY_FADE}
        onClick={handleOverlayClick}
        className="modal-immersive-overlay"
      >
        <motion.div
          key="preview-shell-mobile"
          {...shellVariant}
          exit={{ ...shellVariant.exit, transition: SPRING_EXIT }}
          onClick={(e) => e.stopPropagation()}
          className="modal-immersive-shell"
          style={paletteVars}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.38 }}
          onDragEnd={handleModalDismissDragEnd}
        >
          <button
            type="button"
            className="modal-immersive-sheet-handle"
            aria-label="Close preview"
            onClick={(e) => {
              e.stopPropagation();
              closeModal();
            }}
          />

          <button
            type="button"
            className="preview-modal-close-btn modal-immersive-close"
            aria-label="Close preview"
            onClick={(e) => {
              e.stopPropagation();
              closeModal();
            }}
          >
            ✕
          </button>

          <section className="modal-immersive-stage">
            <AmbientArtworkBackground src={coverSrc} type={coverType} alt={single.title} palette={palette} />

            <div className="modal-immersive-art">
              <CoverArt
                key={single.slug}
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
              onToggle={() => {
                setGlyphsOpen(false);
                setViewMoreOpen((o) => !o);
              }}
              onCollapse={collapseDrawer}
              isMobile
              creditRows={creditRows}
              handleDrawerDragEnd={handleDrawerDragEnd}
              palette={palette}
            />

            <GlyphLyricsPanel
              open={glyphsOpen}
              lrcText={lrcText}
              audioRef={audioRef}
              isMobile
              onClose={() => setGlyphsOpen(false)}
            />
          </section>

          <section
            className="modal-immersive-panel"
            style={{ opacity: glyphsOpen ? 0 : 1, pointerEvents: glyphsOpen ? "none" : "auto" }}
          >
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
              onOpenGlyphs={() => {
                setViewMoreOpen(false);
                setGlyphsOpen(true);
              }}
              palette={palette}
            />

            <PreviewPlayerControls audioRef={audioRef} palette={palette} compact />

            <ModalActionButtons
              showPurchase={showPurchase}
              showGift={isAdmin}
              priceLabel={priceLabel}
              palette={palette}
              onAddToCart={handleAddToCart}
              onGift={() => onGift?.(single)}
            />

            {showPurchase ? (
              <button type="button" className="modal-immersive-vinyl-link" onClick={() => { onAddVinyl(single); closeModal(); }}>
                + Add Vinyl – $47.99 (Optional)
              </button>
            ) : null}
          </section>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="preview-overlay"
      {...OVERLAY_FADE}
      onClick={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.82)",
        zIndex: 8888,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <motion.div
        key="preview-shell"
        {...shellVariant}
        exit={{ ...shellVariant.exit, transition: SPRING_EXIT }}
        onClick={(e) => e.stopPropagation()}
        className="modal-immersive-shell modal-immersive-shell--desktop"
        style={{
          ...paletteVars,
          border: "1px solid #222",
          borderRadius: 20,
          width: "min(420px, 96vw)",
          maxWidth: "100%",
          maxHeight: "94vh",
          boxShadow: `0 0 48px ${palette.primaryGlow}, 0 24px 80px rgba(0,0,0,0.65)`,
        }}
      >
        <motion.div
          layout
          initial={{ opacity: 0.85, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, boxShadow: `0 0 36px ${palette.primaryGlow}` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
          style={{
            position: "relative",
            width: "100%",
            height: "min(52vh, 520px)",
            flexShrink: 0,
            overflow: "hidden",
            background: "#000",
          }}
        >
          <AmbientArtworkBackground src={coverSrc} type={coverType} alt={single.title} palette={palette} />
          <CoverArt
            key={single.slug}
            src={coverSrc}
            type={coverType}
            alt={single.title}
            width="100%"
            height="100%"
            style={{ objectFit: "contain", objectPosition: "center top", pointerEvents: "none", position: "relative", zIndex: 2 }}
          />
          <FloatingViewMore
            open={viewMoreOpen}
            onToggle={() => {
              setGlyphsOpen(false);
              setViewMoreOpen((o) => !o);
            }}
            onCollapse={collapseDrawer}
            isMobile={false}
            creditRows={creditRows}
            handleDrawerDragEnd={handleDrawerDragEnd}
            palette={palette}
          />
          <GlyphLyricsPanel
            open={glyphsOpen}
            lrcText={lrcText}
            audioRef={audioRef}
            isMobile={false}
            onClose={() => setGlyphsOpen(false)}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: glyphsOpen ? 0 : 1, y: glyphsOpen ? 10 : 0 }}
          transition={{ delay: glyphsOpen ? 0 : 0.42, duration: 0.35 }}
          style={{
            padding: "16px 22px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflowY: "auto",
            pointerEvents: glyphsOpen ? "none" : "auto",
          }}
        >
          <div className="hero-title-glow" style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, lineHeight: 1.2 }}>
            {single.title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, opacity: 0.45, letterSpacing: 1 }}>
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
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setViewMoreOpen(false);
                  setGlyphsOpen(true);
                }}
                style={{
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
                }}
              >
                GLYPHS
              </button>
            </div>
          ) : null}

          <PreviewModalPlayer audioRef={audioRef} compact={false} />

          {isAdmin ? <GiftButton onClick={() => onGift?.(single)} style={{ width: "100%", marginBottom: 8 }} /> : null}
          {showPurchase ? (
            <button
              type="button"
              onClick={handleAddToCart}
              style={{
                width: "100%",
                padding: "12px 0",
                background: "#1f1f1f",
                color: "white",
                border: "1px solid #333",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Add to Cart{priceLabel ? ` – ${priceLabel}` : ""}
            </button>
          ) : null}
          {showPurchase ? (
            <button
              type="button"
              onClick={() => {
                onAddVinyl(single);
                closeModal();
              }}
              style={{
                width: "100%",
                padding: "12px 0",
                background: "#0a0a0a",
                color: palette.primaryCss,
                border: `1px solid ${palette.primaryCss}`,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: "bold",
              }}
            >
              + Add Vinyl – $47.99 (Optional)
            </button>
          ) : null}
          <button
            type="button"
            onClick={closeModal}
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, marginTop: 2 }}
          >
            Close
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default memo(ImmersivePreviewModal);
