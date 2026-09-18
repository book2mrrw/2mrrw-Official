"use client";

import { useState } from "react";
import { isIOS } from "@/lib/platform/detect";

/**
 * Unlike usePointerCapability/useReducedMotion (which subscribe to real
 * matchMedia changes via useSyncExternalStore), platform identity can't
 * change during a session, so this just computes once via lazy useState
 * init rather than subscribing to anything. Server render sees no
 * navigator and resolves isIOS=false; a real device's client render can
 * then resolve true on the very first render, before hydration -- fine
 * for internal timing/logic (this hook's only intended use), but never
 * feed this into JSX output that must match between server and client.
 */
export function usePlatform() {
  const [platform] = useState(() => ({ isIOS: isIOS() }));
  return platform;
}
