"use client";

import { useMemo, useState, memo, useCallback, useEffect, useRef } from "react";
import { isFirstListen, markListened } from "@/lib/first-listen";
import { useAudioPlayer } from "@/context/AudioContext";
import PreviewEndedCTA from "@/components/preview/PreviewEndedCTA";
import { getReleaseEditorial, getCreditsDisplayRows } from "@/components/preview/releaseMetadata";
import { extractLrcFromRelease } from "@/lib/lrc";
import { useCoverPalette, paletteToCssVars } from "@/hooks/useCoverPalette";
import { catalogCoverDisplay } from "@/components/home/catalogMedia";
import { usePlayerBodyState } from "@/lib/player/usePlayerBodyState";
import { PlayerAtmosphere } from "@/components/player/ImmersivePlayerEngine";
import ModalShell from "@/components/modal/ModalShell";
import ImmersiveModalEnvironment from "@/components/preview/immersive/ImmersiveModalEnvironment";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { ImmersiveErrorBoundary } from "@/system/errors";
import { useMediaTiming } from "@/system/performance";

const DRAWER_COLLAPSE_THRESHOLD = 72;
const MODAL_DISMISS_THRESHOLD = 56;

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
  const { previewEnded, setPreviewEnded, currentTrack, playTrack } = useAudioPlayer();
  const [contentReady, setContentReady] = useState(false);
  const [viewMoreOpen, setViewMoreOpen] = useState(false);
  const [glyphsOpen, setGlyphsOpen] = useState(false);
  const [firstListen, setFirstListen] = useState(false);
  const [ownershipMoment, setOwnershipMoment] = useState(false);
  const prevCanStreamRef = useRef(false);

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

  useEffect(() => {
    if (!single?.slug || !isFirstListen(single.slug)) return undefined;
    setFirstListen(true);
    const timer = setTimeout(() => {
      setFirstListen(false);
      markListened(single.slug);
    }, 3000);
    return () => clearTimeout(timer);
  }, [single?.slug]);

  useEffect(() => {
    if (trackAccess?.canStream && !prevCanStreamRef.current) {
      setOwnershipMoment(true);
      const timer = setTimeout(() => setOwnershipMoment(false), 800);
      prevCanStreamRef.current = Boolean(trackAccess?.canStream);
      return () => clearTimeout(timer);
    }
    prevCanStreamRef.current = Boolean(trackAccess?.canStream);
    return undefined;
  }, [trackAccess?.canStream]);

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

  const coverDisplay = useMemo(() => catalogCoverDisplay(single || {}), [single]);
  const coverSrc = coverDisplay.src;
  const coverType = coverDisplay.type || single?.coverArtType || "image";
  const coverArtKey = single?.slug || single?.id || "preview";
  const palette = useCoverPalette(coverSrc, coverType);
  const paletteVars = paletteToCssVars(palette);
  const canStream = Boolean(trackAccess?.canStream);
  const previewOnly = Boolean(trackAccess && !trackAccess.canStream);
  const showPurchase = trackAccess ? Boolean(trackAccess.showCart) : true;
  const priceLabel =
    single?.price != null && showPurchase ? `$${Number(single.price).toFixed(2)}` : null;
  const showPreviewEndedCTA =
    previewOnly && previewEnded && Boolean(single?.slug) && currentTrack?.slug === single.slug;

  const handleAddToCart = useCallback(() => {
    onAddToCart(single);
    closeModal();
  }, [onAddToCart, single, closeModal]);

  const handleUnlockFromPreviewEnd = useCallback(() => {
    onAddToCart(single);
  }, [onAddToCart, single]);

  const handleContinueListening = useCallback(() => {
    setPreviewEnded(false);
    if (currentTrack?.slug === single?.slug && currentTrack) {
      void playTrack({ ...currentTrack }, { resumeAt: 0 });
    }
  }, [setPreviewEnded, currentTrack, single?.slug, playTrack]);

  const previewEndedCTA = useMemo(
    () =>
      showPreviewEndedCTA ? (
        <PreviewEndedCTA
          priceLabel={priceLabel}
          showPurchase={showPurchase}
          onContinueListening={handleContinueListening}
          onUnlock={handleUnlockFromPreviewEnd}
        />
      ) : null,
    [
      showPreviewEndedCTA,
      priceLabel,
      showPurchase,
      handleContinueListening,
      handleUnlockFromPreviewEnd,
    ]
  );

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

  const panelStyle = useMemo(
    () => ({
      opacity: glyphsOpen ? 0 : 1,
      pointerEvents: glyphsOpen ? "none" : "auto",
      ...(isMobile ? {} : { padding: "16px 22px 22px", display: "flex", flexDirection: "column", gap: 10 }),
    }),
    [glyphsOpen, isMobile]
  );

  const stageProps = useMemo(
    () => ({
      coverSrc,
      coverType,
      coverArtKey,
      title: single?.title,
      palette,
      isMobile,
      creditRows,
      viewMoreOpen,
      onViewMoreToggle: handleViewMoreToggle,
      onViewMoreCollapse: collapseDrawer,
      handleDrawerDragEnd,
      glyphsOpen,
      lrcText,
      onCloseGlyphs: handleCloseGlyphs,
      canStream,
      previewOnly,
      track: single,
    }),
    [
      coverSrc,
      coverType,
      coverArtKey,
      single?.title,
      palette,
      isMobile,
      creditRows,
      viewMoreOpen,
      handleViewMoreToggle,
      collapseDrawer,
      handleDrawerDragEnd,
      glyphsOpen,
      lrcText,
      handleCloseGlyphs,
      canStream,
      previewOnly,
    ]
  );

  const panelProps = useMemo(
    () => ({
      panelStyle,
      single,
      trackAccess,
      canStream,
      showPurchase,
      priceLabel,
      userId,
      onLibraryChange,
      hasLyrics,
      onOpenGlyphs: handleOpenGlyphs,
      palette,
      isAdmin,
      onAddToCart: handleAddToCart,
      onGift: handleGift,
      onAddVinyl: handleAddVinyl,
      onClose: closeModal,
      previewEndedCTA,
    }),
    [
      panelStyle,
      single,
      trackAccess,
      canStream,
      showPurchase,
      priceLabel,
      userId,
      onLibraryChange,
      hasLyrics,
      handleOpenGlyphs,
      palette,
      isAdmin,
      handleAddToCart,
      handleGift,
      handleAddVinyl,
      closeModal,
      previewEndedCTA,
    ]
  );

  if (!single) return null;

  return (
    <ImmersiveErrorBoundary onExitImmersive={onClose}>
      <ModalShell
        stackId="immersive-preview"
        isMobile={isMobile}
        paletteVars={paletteVars}
        onOverlayClick={handleOverlayClick}
        onDragEnd={handleModalDismissDragEnd}
        onClose={onClose}
        desktopStyle={desktopShellStyle}
      >
        <PlayerAtmosphere open />
        <div
          className={[
            "modal-immersive-body",
            isMobile ? "modal-immersive-body--mobile" : "modal-immersive-body--desktop",
            firstListen ? "modal-immersive--first-listen" : "",
            ownershipMoment ? "modal-immersive--owned-flash" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <ImmersiveModalEnvironment
            contentReady={contentReady}
            isMobile={isMobile}
            glyphsOpen={glyphsOpen}
            desktopStageStyle={desktopStageStyle}
            desktopStageMotion={{ boxShadow: `0 0 36px ${palette.primaryGlow}` }}
            stageProps={stageProps}
            panelProps={panelProps}
            onCloseClick={handleCloseClick}
            trackAccess={trackAccess}
            canStream={canStream}
            palette={palette}
          />
        </div>
      </ModalShell>
    </ImmersiveErrorBoundary>
  );
}

export default memo(ImmersivePreviewModal);
