"use client";

import { memo } from "react";
import AtmosphericBackgroundLayer from "@/components/preview/immersive/AtmosphericBackgroundLayer";
import AmbientLightingLayer from "@/components/preview/immersive/AmbientLightingLayer";
import ImmersiveModalScene from "@/components/preview/immersive/ImmersiveModalScene";
import FloatingArtworkHero from "@/components/preview/immersive/FloatingArtworkHero";
import ViewMoreExpansion from "@/components/preview/immersive/FloatingViewMore";
import PreviewPlayerControls from "@/components/preview/immersive/PreviewPlayerControls";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";
import { useMediaEngine } from "@/media/useMediaEngine";

function ImmersiveModalStage({
  className = "modal-immersive-stage",
  style,
  coverSrc,
  coverType,
  coverArtKey,
  title,
  palette,
  isMobile,
  creditRows,
  viewMoreOpen,
  onViewMoreToggle,
  onViewMoreCollapse,
  handleDrawerDragEnd,
  glyphsOpen,
  lrcText,
  onCloseGlyphs,
  canStream,
  previewOnly,
  track = null,
}) {
  const {
    state: { csMode, atmosphereLevel, playbackState, currentTime },
    analyser,
    currentTrack,
  } = useMediaEngine();
  const baseCoverSrc = currentTrack?.baseCover || currentTrack?.cover || coverSrc;
  const baseCoverType = currentTrack?.coverArtType || coverType;
  const csCoverSrc = currentTrack?.csCover || null;
  const csCoverType = currentTrack?.csCoverType || "image";
  const stageClass = [className, isMobile ? "modal-immersive-stage--mobile" : ""].filter(Boolean).join(" ");

  return (
    <section className={stageClass} style={style}>
      <ImmersiveModalScene
        palette={palette}
        analyser={analyser}
        csMode={csMode}
        atmosphereLevel={atmosphereLevel}
        playbackState={playbackState}
        previewOnly={previewOnly}
        currentTime={currentTime}
      />
      <AtmosphericBackgroundLayer src={coverSrc} type={coverType} palette={palette} />
      <AmbientLightingLayer palette={palette} />
      <FloatingArtworkHero
        coverSrc={coverSrc}
        coverType={coverType}
        baseCoverSrc={baseCoverSrc}
        baseCoverType={baseCoverType}
        csCoverSrc={csCoverSrc}
        csCoverType={csCoverType}
        csMode={csMode}
        coverArtKey={coverArtKey}
        title={title}
        palette={palette}
        isMobile={isMobile}
      />
      {isMobile ? (
        <div className="modal-immersive-float-player immersive-layer immersive-layer--ui">
          <PreviewPlayerControls
            palette={palette}
            compact
            variant="floating"
            canStream={canStream}
            previewOnly={previewOnly}
            track={track}
          />
        </div>
      ) : null}
      <ViewMoreExpansion
        open={viewMoreOpen}
        onToggle={onViewMoreToggle}
        onCollapse={onViewMoreCollapse}
        isMobile={isMobile}
        creditRows={creditRows}
        handleDrawerDragEnd={handleDrawerDragEnd}
        palette={palette}
      />
      <GlyphLyricsPanel
        open={glyphsOpen}
        lrcText={lrcText}
        isMobile={isMobile}
        onClose={onCloseGlyphs}
      />
    </section>
  );
}

export default memo(ImmersiveModalStage);
