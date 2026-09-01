"use client";

import { useSyncExternalStore } from "react";
import {
  getAudioMediaPriorityServerSnapshot,
  getAudioMediaPrioritySnapshot,
  subscribeAudioMediaPriority,
} from "@/lib/media/audio-media-priority";

export function useAudioMediaPriority() {
  return useSyncExternalStore(
    subscribeAudioMediaPriority,
    getAudioMediaPrioritySnapshot,
    getAudioMediaPriorityServerSnapshot
  );
}
