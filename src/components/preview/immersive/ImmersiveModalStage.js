"use client";

import { memo } from "react";
import AtmosphericBackgroundLayer from "@/components/preview/immersive/AtmosphericBackgroundLayer";
import AmbientLightingLayer from "@/components/preview/immersive/AmbientLightingLayer";
import FloatingArtworkHero from "@/components/preview/immersive/FloatingArtworkHero";
import ViewMoreExpansion from "@/components/preview/immersive/FloatingViewMore";
import GlyphLyricsPanel from "@/components/preview/GlyphLyricsPanel";

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
}) {
  return (
    <section className={className} style={style}>
      <AtmosphericBackgroundLayer src={coverSrc} type={coverType} palette={palette} />
      <AmbientLightingLayer palette={palette} />
      <FloatingArtworkHero
        coverSrc={coverSrc}
        coverType={coverType}
        coverArtKey={coverArtKey}
        title={title}
        palette={palette}
        isMobile={isMobile}
      />
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
