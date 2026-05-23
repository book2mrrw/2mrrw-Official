"use client";

import { useMemo, useState, memo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PreviewModalPlayer from "@/components/preview/PreviewModalPlayer";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { extractLrcFromRelease } from "@/lib/lrc";
import MusicAccessBadge from "@/components/music/MusicAccessBadge";
import MusicPlusButton from "@/components/music/MusicPlusButton";
import GiftButton from "@/components/gifts/GiftButton";
import CoverArt from "@/components/ui/CoverArt";

const SPRING_SOFT = { type: "spring", stiffness: 320, damping: 34 };
const SPRING_EXIT = { type: "spring", stiffness: 380, damping: 36 };
const OVERLAY_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.28 },
};
const SHEET_UP = {
  initial: { y: "100%", scale: 0.92, opacity: 0.5 },
  animate: { y: 0, scale: 1, opacity: 1 },
  exit: { y: "100%", scale: 0.94, opacity: 0.4 },
  transition: SPRING_SOFT,
};
const MODAL_CENTER = {
  initial: { opacity: 0, scale: 0.88, y: 24 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, y: 12 },
  transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
};
const DRAWER_SPRING = { type: "spring", stiffness: 340, damping: 36 };
const DRAWER_COLLAPSE_THRESHOLD = 72;
const MODAL_DISMISS_THRESHOLD = 56;

const tabBtnStyle = (active) => ({
  background: active ? "rgba(0,255,255,0.12)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${active ? "rgba(0,255,255,0.35)" : "rgba(255,255,255,0.1)"}`,
  color: active ? "#e8ffff" : "rgba(255,255,255,0.72)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 2,
  textTransform: "uppercase",
  padding: "8px 14px",
  borderRadius: 20,
  cursor: "pointer",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  boxShadow: active ? "0 0 14px rgba(0,255,255,0.2)" : "none",
  transition: "all 0.22s",
});

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
  const lrcText = useMemo(() => extractLrcFromRelease(release), [release]);

  const mediaHeight = isMobile ? "min(72vh, 75dvh)" : "min(52vh, 520px)";
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
        alignItems: isMobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
      }}
    >
      <motion.div
        key="preview-shell"
        {...shellVariant}
        exit={{ ...shellVariant.exit, transition: SPRING_EXIT }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0a0a0a",
          border: isMobile ? "1px solid #1e1e1e" : "1px solid #222",
          borderRadius: isMobile ? "20px 20px 0 0" : 20,
          width: isMobile ? "100%" : "min(420px, 96vw)",
          maxWidth: "100%",
          maxHeight: isMobile ? "96vh" : "94vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 0 48px rgba(0,255,255,0.12), 0 24px 80px rgba(0,0,0,0.65)",
          willChange: "transform",
          position: "relative",
        }}
      >
        {isMobile && (
          <button
            type="button"
            className="preview-modal-close-btn"
            aria-label="Close preview"
            onClick={(e) => {
              e.stopPropagation();
              closeModal();
            }}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              zIndex: glyphsOpen || viewMoreOpen ? 30 : 20,
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "50%",
              width: 34,
              height: 34,
              color: "rgba(255,255,255,0.8)",
              fontSize: 18,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            ✕
          </button>
        )}
        <motion.div
          layout
          initial={isMobile ? { opacity: 0.88, scale: 0.97 } : { opacity: 0.85, scale: 0.96 }}
          animate={{
            opacity: 1,
            scale: 1,
            boxShadow: "0 0 36px rgba(0,255,255,0.18)",
          }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: isMobile ? 0.06 : 0.12 }}
          style={{
            position: "relative",
            width: "100%",
            height: mediaHeight,
            flexShrink: 0,
            overflow: "hidden",
            background: "#000",
          }}
        >
          <CoverArt
            key={single.slug}
            src={coverSrc}
            type={coverType}
            alt={single.title}
            width="100%"
            height="100%"
            style={{
              objectFit: isMobile ? "cover" : "contain",
              objectPosition: "center top",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.25) 42%, transparent 68%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: isMobile ? "10px 14px 12px" : "12px 16px 14px",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              background: "rgba(8,8,8,0.35)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              zIndex: 4,
            }}
          >
            <button
              type="button"
              style={tabBtnStyle(viewMoreOpen)}
              onClick={() => {
                setGlyphsOpen(false);
                setViewMoreOpen((o) => !o);
              }}
            >
              View More
            </button>
          </div>

          <AnimatePresence>
            {viewMoreOpen ? (
              <motion.div
                key="view-more"
                drag={isMobile ? "y" : false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.35 }}
                onDragEnd={isMobile ? handleDrawerDragEnd : undefined}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={DRAWER_SPRING}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  maxHeight: "58%",
                  zIndex: 5,
                  background:
                    "linear-gradient(to top, rgba(6,6,6,0.97) 72%, rgba(6,6,6,0.88) 100%)",
                  borderTop: "1px solid rgba(0,255,255,0.15)",
                  padding: isMobile ? "10px 18px 20px" : "16px 18px 20px",
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {isMobile ? (
                  <button
                    type="button"
                    className="preview-drawer-handle"
                    aria-label="Collapse credits"
                    onClick={collapseDrawer}
                  />
                ) : null}
                <div className="preview-credits-heading">CREDITS</div>
                {creditRows.length ? (
                  creditRows.map(({ key, label, value }) => (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "7px 0",
                        borderBottom: "1px solid #141414",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "#666", flexShrink: 0 }}>{label}</span>
                      <span style={{ color: "#ddd", textAlign: "right", lineHeight: 1.4 }}>
                        {value}
                      </span>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: 12, color: "#555", margin: 0, fontStyle: "italic" }}>
                    Credits available soon.
                  </p>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <GlyphLyricsPanel
            open={glyphsOpen}
            lrcText={lrcText}
            audioRef={audioRef}
            isMobile={isMobile}
            onClose={() => setGlyphsOpen(false)}
          />
        </motion.div>

        {isMobile ? (
          <motion.button
            type="button"
            className="preview-sheet-dismiss-handle"
            aria-label="Close preview"
            onClick={(e) => {
              e.stopPropagation();
              closeModal();
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={handleModalDismissDragEnd}
          />
        ) : null}

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: glyphsOpen ? 0 : 1, y: glyphsOpen ? 10 : 0 }}
          transition={{ delay: glyphsOpen ? 0 : 0.42, duration: 0.35 }}
          style={{
            padding: isMobile ? "14px 18px 24px" : "16px 22px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflowY: "auto",
            pointerEvents: glyphsOpen ? "none" : "auto",
          }}
        >
          <div
            className={isMobile ? "song-title-turquoise-glow" : "hero-title-glow"}
            style={{
              fontSize: isMobile ? 22 : 20,
              fontWeight: 800,
              letterSpacing: 1,
              lineHeight: 1.2,
            }}
          >
            {single.title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, opacity: 0.45, letterSpacing: 1 }}>
              {canStream ? "FULL STREAM" : "SINGLE PREVIEW"}
              {showPurchase && priceLabel ? ` · ${priceLabel}` : ""}
            </div>
            <MusicAccessBadge access={trackAccess} label={trackAccess?.badge} compact />
            {userId && (
              <MusicPlusButton
                track={single}
                userId={userId}
                access={trackAccess}
                isMobile={isMobile}
                onLibraryChange={onLibraryChange}
              />
            )}
          </div>

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

          <PreviewModalPlayer audioRef={audioRef} compact={isMobile} />

          {isAdmin ? (
            <GiftButton
              onClick={() => onGift?.(single)}
              style={{ width: "100%", marginBottom: 8 }}
            />
          ) : null}
          {showPurchase ? (
            <button
              type="button"
              onClick={() => {
                onAddToCart(single);
                closeModal();
              }}
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
                color: "#00ffff",
                border: "1px solid #00ffff",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: "bold",
              }}
            >
              + Add Vinyl – $47.99 (Optional)
            </button>
          ) : null}
          {!isMobile ? (
            <button
              type="button"
              onClick={closeModal}
              style={{
                background: "none",
                border: "none",
                color: "#555",
                cursor: "pointer",
                fontSize: 12,
                marginTop: 2,
              }}
            >
              Close
            </button>
          ) : null}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default memo(ImmersivePreviewModal);
