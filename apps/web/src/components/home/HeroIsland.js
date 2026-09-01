"use client";

import { memo } from "react";
import HeroSection from "@/components/home/HeroSection";

/**
 * Phase 17C — Hero render island: only layout props cross the Page boundary.
 */
const HeroIsland = memo(function HeroIsland({
  heroContainerRef,
  heroVideoRef,
  heroTextRef,
  heroSocialsRef,
}) {
  return (
    <HeroSection
      heroContainerRef={heroContainerRef}
      heroVideoRef={heroVideoRef}
      heroTextRef={heroTextRef}
      heroSocialsRef={heroSocialsRef}
    />
  );
});

export default HeroIsland;
