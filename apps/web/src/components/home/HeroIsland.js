"use client";

import { memo, useMemo } from "react";
import HeroSection from "@/components/home/HeroSection";

/**
 * Phase 17C — Hero render island: only layout props cross the Page boundary.
 */
const HeroIsland = memo(function HeroIsland({
  isMobile,
  heroContainerRef,
  heroVideoRef,
  heroTextRef,
  heroSocialsRef,
}) {
  const mobileHeroHeight = useMemo(() => (isMobile ? 200 : 380), [isMobile]);

  return (
    <HeroSection
      isMobile={isMobile}
      mobileHeroHeight={mobileHeroHeight}
      heroContainerRef={heroContainerRef}
      heroVideoRef={heroVideoRef}
      heroTextRef={heroTextRef}
      heroSocialsRef={heroSocialsRef}
    />
  );
});

export default HeroIsland;
