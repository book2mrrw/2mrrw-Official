"use client";

import { useSyncExternalStore } from "react";
import {
  getPlaybackChromeLayout,
  subscribePlaybackChromeLayout,
} from "@/lib/storefront/playback-chrome-layout-store";

/** Phase P12 — scroll padding / flow mode without PlaybackChromeContext reconcile. */
export function usePlaybackChromeLayout() {
  return useSyncExternalStore(
    subscribePlaybackChromeLayout,
    getPlaybackChromeLayout,
    getPlaybackChromeLayout
  );
}
