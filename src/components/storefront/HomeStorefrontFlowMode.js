"use client";

import { memo, useMemo } from "react";
import HomeStorefront from "@/components/home/HomeStorefront";
import { usePlaybackChrome } from "@/components/storefront/playback-chrome-context";

/**
 * Subscribes to playback chrome for activeFlowMode without re-rendering Page or Hero.
 */
const HomeStorefrontFlowMode = memo(function HomeStorefrontFlowMode({
  flowConversionActive,
  onFlowConversionActive,
  ...homeProps
}) {
  const { nowPlaying } = usePlaybackChrome();
  const activeFlowMode = useMemo(
    () => (flowConversionActive ? "conversion" : nowPlaying ? "nowplaying" : "idle"),
    [flowConversionActive, nowPlaying]
  );

  return (
    <HomeStorefront
      {...homeProps}
      activeFlowMode={activeFlowMode}
      onFlowConversionActive={onFlowConversionActive}
    />
  );
});

export default HomeStorefrontFlowMode;
