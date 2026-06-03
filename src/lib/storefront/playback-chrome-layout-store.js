"use client";

import { logUiHydrationTrace, isUiHydrationTraceEnabled } from "@/lib/diagnostics/ui-hydration-trace";

/**
 * Phase P12 — playback chrome layout (padding / nowPlaying) without React context
 * propagation through the storefront tree.
 */

const DEFAULT_LAYOUT = Object.freeze({
  nowPlayingKey: null,
  mobileScrollPadding: "110px",
  mobileCartFabBottom: "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)",
  mobileMiniPlayerBottom: "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)",
});

let layout = DEFAULT_LAYOUT;
const listeners = new Set();

function nowPlayingKey(track) {
  if (!track) return null;
  return track.slug ?? track.id ?? track.trackId ?? null;
}

export function getPlaybackChromeLayout() {
  return layout;
}

export function commitPlaybackChromeLayout(next) {
  const nextKey = nowPlayingKey(next?.nowPlaying);
  const mobileScrollPadding = next?.mobileScrollPadding ?? DEFAULT_LAYOUT.mobileScrollPadding;
  const mobileCartFabBottom =
    next?.mobileCartFabBottom ?? DEFAULT_LAYOUT.mobileCartFabBottom;
  const mobileMiniPlayerBottom =
    next?.mobileMiniPlayerBottom ?? DEFAULT_LAYOUT.mobileMiniPlayerBottom;

  if (
    layout.nowPlayingKey === nextKey &&
    layout.mobileScrollPadding === mobileScrollPadding &&
    layout.mobileCartFabBottom === mobileCartFabBottom &&
    layout.mobileMiniPlayerBottom === mobileMiniPlayerBottom
  ) {
    return;
  }

  layout = {
    nowPlayingKey: nextKey,
    mobileScrollPadding,
    mobileCartFabBottom,
    mobileMiniPlayerBottom,
  };

  if (isUiHydrationTraceEnabled()) {
    logUiHydrationTrace("PLAYBACK_CHROME_LAYOUT_COMMIT", {
      nowPlayingKey: nextKey,
      mobileScrollPadding,
      phase: "p12-layout-store",
    });
  }

  listeners.forEach((listener) => listener());
}

export function subscribePlaybackChromeLayout(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
