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

export function useModalTiming() {
  const onModalOpenStart = useCallback(() => {
    perfMark(MARKS.MODAL_OPEN_START);
  }, []);

  const onModalOpenEnd = useCallback(() => {
    if (typeof requestAnimationFrame === "undefined") {
      perfMark(MARKS.MODAL_OPEN_END);
      perfMeasure("modal-open", MARKS.MODAL_OPEN_START, MARKS.MODAL_OPEN_END);
      return;
    }
    requestAnimationFrame(() => {
      perfMark(MARKS.MODAL_OPEN_END);
      perfMeasure("modal-open", MARKS.MODAL_OPEN_START, MARKS.MODAL_OPEN_END);
      if (typeof performance !== "undefined") {
        const entries = performance.getEntriesByName("modal-open", "measure");
        const last = entries[entries.length - 1];
        if (last) reportMeasure("modal-open", last.duration);
      }
    });
  }, []);

  return { onModalOpenStart, onModalOpenEnd };
}
