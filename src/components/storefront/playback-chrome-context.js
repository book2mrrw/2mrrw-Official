"use client";

import { createContext, useContext } from "react";

/** @type {import("react").Context<{
 *   nowPlaying: object | null;
 *   mobileScrollPadding: string;
 *   mobileCartFabBottom: string;
 *   mobileMiniPlayerBottom: string;
 * }>} */
export const PlaybackChromeContext = createContext({
  nowPlaying: null,
  mobileScrollPadding: "110px",
  mobileCartFabBottom: "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)",
  mobileMiniPlayerBottom: "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)",
});

export function usePlaybackChrome() {
  return useContext(PlaybackChromeContext);
}
