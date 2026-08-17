"use client";

import { useEffect } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { globalMediaController } from "@/media/visualEngine/GlobalMediaController";

/**
 * Wires the GlobalMediaController's audio bridge to the live React audio engine.
 * Mount once near the app root (inside AudioProvider or a layout component).
 * No visual output — pure side-effect hook.
 *
 * pause()               — dispatches PLAYBACK_COMMANDS.PAUSE through the SM
 * resumeTrackAtPosition — resumes from a saved position (used after independent visual)
 */
export function useGlobalMediaControllerBridge() {
  const { pause, resume, resumeTrackAtPosition } = useAudioPlayer();

  useEffect(() => {
    globalMediaController.registerAudioBridge({
      pause: () => {
        try { pause?.(); } catch {}
      },
      resume: (at) => {
        try {
          if (at != null && typeof resumeTrackAtPosition === 'function') {
            resumeTrackAtPosition(at);
          } else {
            resume?.();
          }
        } catch {}
      },
    });

    return () => {
      globalMediaController.registerAudioBridge({ pause: null, resume: null });
    };
  }, [pause, resume, resumeTrackAtPosition]);
}
