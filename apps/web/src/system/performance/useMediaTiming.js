"use client";

import { useCallback } from "react";
import { MARKS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";

function reportMeasure(mark, duration) {
  import("@/system/telemetry")
    .then(({ telemetry }) => {
      telemetry.log({ type: "performance.measure", mark, duration });
    })
    .catch(() => {});
}

export function useMediaTiming() {
  const onArtworkLoadStart = useCallback(() => {
    perfMark(MARKS.ARTWORK_DECODE_START);
  }, []);

  const onArtworkLoadEnd = useCallback(() => {
    perfMark(MARKS.ARTWORK_DECODE_END);
    perfMeasure("artwork-decode", MARKS.ARTWORK_DECODE_START, MARKS.ARTWORK_DECODE_END);
  }, []);

  const onAudioPlayStart = useCallback(() => {
    perfMark(MARKS.AUDIO_START_LATENCY_START);
  }, []);

  const onAudioPlaying = useCallback(() => {
    perfMark(MARKS.AUDIO_START_LATENCY_END);
    perfMeasure("audio-start-latency", MARKS.AUDIO_START_LATENCY_START, MARKS.AUDIO_START_LATENCY_END);
    if (typeof performance !== "undefined") {
      const entries = performance.getEntriesByName("audio-start-latency", "measure");
      const last = entries[entries.length - 1];
      if (last) reportMeasure("audio-start-latency", last.duration);
    }
  }, []);

  const onImmersiveRenderStart = useCallback(() => {
    perfMark(MARKS.IMMERSIVE_RENDER_START);
  }, []);

  const onImmersiveRenderEnd = useCallback(() => {
    if (typeof requestAnimationFrame === "undefined") {
      perfMark(MARKS.IMMERSIVE_RENDER_END);
      perfMeasure("immersive-render", MARKS.IMMERSIVE_RENDER_START, MARKS.IMMERSIVE_RENDER_END);
      return;
    }
    requestAnimationFrame(() => {
      perfMark(MARKS.IMMERSIVE_RENDER_END);
      perfMeasure("immersive-render", MARKS.IMMERSIVE_RENDER_START, MARKS.IMMERSIVE_RENDER_END);
    });
  }, []);

  return {
    onArtworkLoadStart,
    onArtworkLoadEnd,
    onAudioPlayStart,
    onAudioPlaying,
    onImmersiveRenderStart,
    onImmersiveRenderEnd,
  };
}
