"use client";

import { useCallback } from "react";
import { MARKS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";

export function useNavTiming() {
  const onRouteNavStart = useCallback(() => {
    perfMark(MARKS.ROUTE_NAV_START);
  }, []);

  const onRouteNavEnd = useCallback(() => {
    const schedule =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback
        : (cb) => setTimeout(cb, 0);
    schedule(() => {
      perfMark(MARKS.ROUTE_NAV_END);
      perfMeasure("route-nav", MARKS.ROUTE_NAV_START, MARKS.ROUTE_NAV_END);
    });
  }, []);

  return { onRouteNavStart, onRouteNavEnd };
}
