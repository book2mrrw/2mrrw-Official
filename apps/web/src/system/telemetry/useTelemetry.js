"use client";

import { useCallback, useRef } from "react";
import { telemetry } from "./telemetry";

export function useTelemetry() {
  const logRef = useRef(telemetry.log);
  logRef.current = telemetry.log;

  const log = useCallback((event) => {
    logRef.current(event);
  }, []);

  return { log };
}
