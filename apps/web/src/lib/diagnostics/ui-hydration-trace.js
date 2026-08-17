/**
 * Phase R1 — ROOT reconcile elimination trace events.
 * Enable: NEXT_PUBLIC_UI_HYDRATION_TRACE=1 (also active when NEXT_PUBLIC_PLAYBACK_TRACE=1).
 */

import { isPlaybackTraceEnabled } from "@/lib/diagnostics/playback-trace";

const EXPLICIT_UI_TRACE =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_UI_HYDRATION_TRACE === "1";

export function isUiHydrationTraceEnabled() {
  return EXPLICIT_UI_TRACE || isPlaybackTraceEnabled();
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [meta]
 */
export function logUiHydrationTrace(event, meta = {}) {
  if (!isUiHydrationTraceEnabled()) return;
  console.debug("[ui-hydration-trace]", { event, ts: Date.now(), ...meta });
}
