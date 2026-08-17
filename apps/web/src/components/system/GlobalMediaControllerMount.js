"use client";

import { useGlobalMediaControllerBridge } from "@/hooks/useGlobalMediaControllerBridge";

/**
 * Mounts the GlobalMediaController audio bridge inside the AudioProvider tree.
 * No visual output — pure side-effect component.
 * Mount once inside <AudioProvider> in the root layout.
 */
export default function GlobalMediaControllerMount() {
  useGlobalMediaControllerBridge();
  return null;
}
