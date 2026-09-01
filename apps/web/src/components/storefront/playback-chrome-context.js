"use client";

import { usePlaybackChromeLayout } from "@/hooks/usePlaybackChromeLayout";

/**
 * @deprecated Prefer usePlaybackChromeLayout (Phase P12 external store).
 * Kept for callers that still import usePlaybackChrome — maps layout store fields.
 */
export function usePlaybackChrome() {
  const layout = usePlaybackChromeLayout();
  return {
    nowPlaying: layout.nowPlayingKey ? { slug: layout.nowPlayingKey } : null,
    mobileScrollPadding: layout.mobileScrollPadding,
    mobileCartFabBottom: layout.mobileCartFabBottom,
    mobileMiniPlayerBottom: layout.mobileMiniPlayerBottom,
  };
}
