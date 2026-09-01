"use client";

import { useEffect } from "react";
import { initPosthog } from "@/system/telemetry/posthogAdapter";

export default function PostHogInit() {
  useEffect(() => {
    initPosthog();
  }, []);
  return null;
}
