/**
 * QoE telemetry for visual media — video playback failures, image decode failures,
 * and decoder-budget events. Wraps the production telemetry pipeline so all visual
 * errors are captured in PostHog alongside audio events without separate instrumentation.
 *
 * All log calls are fire-and-forget (dynamic import inside telemetry.log) and
 * never throw — this module is safe to call from render error handlers.
 */

import { telemetry } from "@/system/telemetry/telemetry";

/** @type {() => import('@/system/telemetry/telemetry').telemetry | null} */
function getTelemetry() {
  if (typeof window === "undefined") return null;
  return telemetry;
}

// ── Event type constants ──────────────────────────────────────────────────────

// Existing QoE events
export const VISUAL_VIDEO_ERROR = "visual.video.error";
export const VISUAL_VIDEO_FALLBACK = "visual.video.fallback";
export const VISUAL_IMAGE_ERROR = "visual.image.error";
export const VISUAL_DECODER_BUDGET_REVOKED = "visual.decoder.budget.revoked";
export const VISUAL_PRELOAD_DEFERRED = "visual.preload.deferred";

// Visual Moment / Full Visual Experience lifecycle events
export const VISUAL_MOMENT_STARTED    = "visual_moment.started";
export const VISUAL_MOMENT_COMPLETED  = "visual_moment.completed";
export const VISUAL_MOMENT_DISMISSED  = "visual_moment.dismissed";
export const VISUAL_EXPANDED          = "visual_moment.expanded";
export const VISUAL_FULL_OPENED       = "visual_full.opened";
export const VISUAL_FULL_CLOSED       = "visual_full.closed";
export const VISUAL_ASSET_ERROR       = "visual_asset.error";

// Interactive artwork performance events (Slow/Screw, Chop, Filter, Video Wake)
export const INTERACTIVE_SLOW_STARTED       = "interactive.slow.started";
export const INTERACTIVE_SLOW_LOCKED        = "interactive.slow.locked";
export const INTERACTIVE_SLOW_UNLOCKED      = "interactive.slow.unlocked";
export const INTERACTIVE_CHOP_USED          = "interactive.chop.used";
export const INTERACTIVE_FILTER_USED        = "interactive.filter.used";
export const INTERACTIVE_VIDEO_WAKE_STARTED = "interactive.video_wake.started";
export const INTERACTIVE_VIDEO_WAKE_ENGAGED = "interactive.video_wake.engaged";
export const INTERACTIVE_VISUAL_MODE_ON     = "interactive.visual_mode.enabled";
export const INTERACTIVE_VISUAL_MODE_OFF    = "interactive.visual_mode.disabled";
export const INTERACTIVE_VIDEO_MODAL_OPENED = "interactive.video_modal.opened";
export const INTERACTIVE_FULLSCREEN_ENTERED = "interactive.fullscreen.entered";
export const INTERACTIVE_FULLSCREEN_EXITED  = "interactive.fullscreen.exited";

// ── Log helpers ───────────────────────────────────────────────────────────────

/**
 * Log a video element error (MediaError or network failure).
 * @param {{ src: string, context: string, errorCode?: number | null }} params
 */
export function logVisualVideoError({ src, context, errorCode = null }) {
  const t = getTelemetry();
  if (!t) return;
  const safeSrc = String(src || "").replace(/\?.*$/, ""); // strip query params
  t.log({ type: VISUAL_VIDEO_ERROR, src: safeSrc, context, errorCode });
}

/**
 * Log when video fails and CoverArt falls back to static image.
 * @param {{ src: string, context: string }} params
 */
export function logVisualVideoFallback({ src, context }) {
  const t = getTelemetry();
  if (!t) return;
  const safeSrc = String(src || "").replace(/\?.*$/, "");
  t.log({ type: VISUAL_VIDEO_FALLBACK, src: safeSrc, context });
}

/**
 * Log a static image decode / network failure.
 * @param {{ src: string, context: string }} params
 */
export function logVisualImageError({ src, context }) {
  const t = getTelemetry();
  if (!t) return;
  const safeSrc = String(src || "").replace(/\?.*$/, "");
  t.log({ type: VISUAL_IMAGE_ERROR, src: safeSrc, context });
}

/**
 * Log when VRM revokes a decoder slot (budget enforcement).
 * @param {{ context: string, budget: number, registered: number }} params
 */
export function logVisualDecoderBudgetRevoked({ context, budget, registered }) {
  const t = getTelemetry();
  if (!t) return;
  t.log({ type: VISUAL_DECODER_BUDGET_REVOKED, context, budget, registered });
}

/**
 * Log when a video element's preload is deferred because it's offscreen at mount.
 * @param {{ context: string }} params
 */
export function logVisualPreloadDeferred({ context }) {
  const t = getTelemetry();
  if (!t) return;
  t.log({ type: VISUAL_PRELOAD_DEFERRED, context });
}

// ── Visual Moment / Full Visual lifecycle helpers ──────────────────────────────

/** @param {{ releaseSlug: string, assetType: string, assetId?: string }} p */
export function logVisualMomentStarted(p) {
  getTelemetry()?.log({ type: VISUAL_MOMENT_STARTED, ...p });
}

/** @param {{ releaseSlug: string, assetType: string, durationMs?: number }} p */
export function logVisualMomentCompleted(p) {
  getTelemetry()?.log({ type: VISUAL_MOMENT_COMPLETED, ...p });
}

/** @param {{ releaseSlug: string, assetType: string }} p */
export function logVisualMomentDismissed(p) {
  getTelemetry()?.log({ type: VISUAL_MOMENT_DISMISSED, ...p });
}

/** @param {{ releaseSlug: string, assetType: string }} p */
export function logVisualExpanded(p) {
  getTelemetry()?.log({ type: VISUAL_EXPANDED, ...p });
}

/** @param {{ releaseSlug: string, assetType: string }} p */
export function logVisualFullOpened(p) {
  getTelemetry()?.log({ type: VISUAL_FULL_OPENED, ...p });
}

/** @param {{ releaseSlug: string, durationMs?: number }} p */
export function logVisualFullClosed(p) {
  getTelemetry()?.log({ type: VISUAL_FULL_CLOSED, ...p });
}

/** @param {{ releaseSlug: string, assetType: string, context: string }} p */
export function logVisualAssetError(p) {
  getTelemetry()?.log({ type: VISUAL_ASSET_ERROR, ...p });
}

// ── Interactive artwork performance log helpers ───────────────────────────────

/** @param {{ slug: string, intensity?: number }} p */
export function logSlowStarted(p) { getTelemetry()?.log({ type: INTERACTIVE_SLOW_STARTED, ...p }); }
/** @param {{ slug: string }} p */
export function logSlowLocked(p)  { getTelemetry()?.log({ type: INTERACTIVE_SLOW_LOCKED,  ...p }); }
/** @param {{ slug: string }} p */
export function logSlowUnlocked(p){ getTelemetry()?.log({ type: INTERACTIVE_SLOW_UNLOCKED,...p }); }
/** @param {{ slug: string, nx: number, ny: number }} p */
export function logChopUsed(p)    { getTelemetry()?.log({ type: INTERACTIVE_CHOP_USED,    ...p }); }
/** @param {{ slug: string, nx: number, ny: number }} p */
export function logFilterUsed(p)  { getTelemetry()?.log({ type: INTERACTIVE_FILTER_USED,  ...p }); }
/** @param {{ slug: string }} p */
export function logVideoWakeStarted(p) { getTelemetry()?.log({ type: INTERACTIVE_VIDEO_WAKE_STARTED, ...p }); }
/** @param {{ slug: string }} p */
export function logVideoWakeEngaged(p) { getTelemetry()?.log({ type: INTERACTIVE_VIDEO_WAKE_ENGAGED, ...p }); }
/** @param {{ slug: string, on: boolean }} p */
export function logVisualModeToggle(p) {
  getTelemetry()?.log({ type: p.on ? INTERACTIVE_VISUAL_MODE_ON : INTERACTIVE_VISUAL_MODE_OFF, slug: p.slug });
}
/** @param {{ slug: string }} p */
export function logVideoModalOpened(p)  { getTelemetry()?.log({ type: INTERACTIVE_VIDEO_MODAL_OPENED, ...p }); }
/** @param {{ trackTitle?: string, artistName?: string }} p */
export function logFullscreenEntered(p) { getTelemetry()?.log({ type: INTERACTIVE_FULLSCREEN_ENTERED, ...p }); }
/** @param {{ trackTitle?: string, artistName?: string }} p */
export function logFullscreenExited(p)  { getTelemetry()?.log({ type: INTERACTIVE_FULLSCREEN_EXITED,  ...p }); }
