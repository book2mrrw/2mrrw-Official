"use client";

import { useRef } from "react";
import { usePlaybackCardPrewarm } from "@/hooks/usePlaybackCardPrewarm";

/**
 * Wraps a release card shell with viewport-triggered playback descriptor prewarm.
 * Forwards all props to the outer div; does not alter layout or interaction.
 */
export default function PlaybackPrewarmCardShell({
  releaseItem,
  playItem = null,
  catalogPlaybackLookup = null,
  accountState = null,
  userId = null,
  source = "home_card",
  isAlbumCard = false,
  enabled = true,
  children,
  ...divProps
}) {
  const cardRef = useRef(null);
  usePlaybackCardPrewarm(cardRef, {
    releaseItem,
    playItem,
    catalogLookup: catalogPlaybackLookup,
    accountState,
    userId,
    source,
    isAlbumCard,
    enabled,
  });

  return (
    <div ref={cardRef} data-playback-prewarm-card {...divProps}>
      {children}
    </div>
  );
}
