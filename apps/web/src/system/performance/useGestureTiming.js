"use client";

import { useCallback, useRef } from "react";
import { MARKS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";

export function useGestureTiming() {
  const gestureStartRef = useRef(0);

  const onGestureStart = useCallback(() => {
    gestureStartRef.current = performance.now?.() ?? Date.now();
    perfMark(MARKS.GESTURE_START);
  }, []);

  const onGestureResponse = useCallback(() => {
    perfMark(MARKS.GESTURE_RESPONSE);
    perfMeasure("gesture-response", MARKS.GESTURE_START, MARKS.GESTURE_RESPONSE);
    const now = performance.now?.() ?? Date.now();
    const duration = now - gestureStartRef.current;
    if (duration > 100) {
      import("@/system/telemetry")
        .then(({ telemetry }) => {
          telemetry.log({ type: "interaction.slow", interaction: "gesture", duration });
        })
        .catch(() => {});
    }
  }, []);

  return { onGestureStart, onGestureResponse };
}
