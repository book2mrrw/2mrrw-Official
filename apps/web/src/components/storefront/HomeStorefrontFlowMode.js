"use client";

import { memo } from "react";
import HomeStorefront from "@/components/home/HomeStorefront";

/**
 * Stable bridge into HomeStorefront. Playback-mode subscriptions live beside
 * the Flow State panel so transport changes never re-render this wrapper.
 */
const HomeStorefrontFlowMode = memo(function HomeStorefrontFlowMode({
  flowConversionActive,
  onFlowConversionActive,
  ...homeProps
}) {
  return (
    <HomeStorefront
      {...homeProps}
      flowConversionActive={flowConversionActive}
      onFlowConversionActive={onFlowConversionActive}
    />
  );
});

export default HomeStorefrontFlowMode;
