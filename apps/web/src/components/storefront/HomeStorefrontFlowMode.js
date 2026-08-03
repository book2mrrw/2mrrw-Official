"use client";

import { memo, useMemo } from "react";
import HomeStorefront from "@/components/home/HomeStorefront";
import { usePlaybackChromeLayout } from "@/hooks/usePlaybackChromeLayout";

/**
 * Subscribes to playback chrome for activeFlowMode without re-rendering Page or Hero.
 */
const HomeStorefrontFlowMode = memo(function HomeStorefrontFlowMode({
  flowConversionActive,
  onFlowConversionActive,
  liveCountdownTarget,
  ...homeProps
}) {
  const { nowPlayingKey } = usePlaybackChromeLayout();
  const activeFlowMode = useMemo(
    () => (flowConversionActive ? "conversion" : nowPlayingKey ? "nowplaying" : "idle"),
    [flowConversionActive, nowPlayingKey]
  );

  return (
    <HomeStorefront
      {...homeProps}
      liveCountdownTarget={liveCountdownTarget}
      activeFlowMode={activeFlowMode}
      onFlowConversionActive={onFlowConversionActive}
    />
  );
});

export default HomeStorefrontFlowMode;
