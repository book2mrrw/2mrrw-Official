"use client";

import { useCallback } from "react";
import { telemetry } from "./telemetry";

export function useTelemetry() {
  const log = useCallback((event) => {
    telemetry.log(event);
  }, []);

  return { log };
}
