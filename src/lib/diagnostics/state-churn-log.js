/**
 * Dev-only Auth / entitlement / recovery churn diagnostics.
 * Enable: NODE_ENV=development (default on) or NEXT_PUBLIC_STATE_CHURN_LOG=1
 * Disable: NEXT_PUBLIC_STATE_CHURN_LOG=0
 *
 * Playback interruption trace (Phase 6C): see playback-trace.js
 * (NEXT_PUBLIC_PLAYBACK_TRACE=1 or development).
 */
export { isPlaybackTraceEnabled } from "@/lib/diagnostics/playback-trace";

const EXPLICIT_OFF =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_STATE_CHURN_LOG === "0";

const EXPLICIT_ON =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_STATE_CHURN_LOG === "1";

export function isStateChurnLogEnabled() {
  if (EXPLICIT_OFF) return false;
  if (EXPLICIT_ON) return true;
  return typeof process !== "undefined" && process.env.NODE_ENV === "development";
}

/**
 * @param {string} kind - e.g. refreshAccountState, entitlements:updated
 * @param {{ source?: string, reason?: string, [key: string]: unknown }} [meta]
 */
export function logStateChurn(kind, meta = {}) {
  if (!isStateChurnLogEnabled()) return;
  const { source = "unknown", reason = "", ...rest } = meta;
  // eslint-disable-next-line no-console
  console.debug("[state-churn]", {
    kind,
    source,
    reason,
    ts: Date.now(),
    ...rest,
  });
}

/**
 * Dev-only playback / stream / queue / media-session failure diagnostics.
 * Same enable/disable flag as logStateChurn.
 *
 * @param {string} kind - e.g. stream-error, media-session-seek, stall-recovery
 * @param {{ source?: string, code?: string, [key: string]: unknown }} [meta]
 */
export function logPlaybackResilience(kind, meta = {}) {
  if (!isStateChurnLogEnabled()) return;
  const { source = "unknown", code = "", ...rest } = meta;
  // eslint-disable-next-line no-console
  console.debug("[playback-resilience]", {
    kind,
    source,
    code,
    ts: Date.now(),
    ...rest,
  });
}

let lastEntitlementsDispatchAt = 0;
const ENTITLEMENTS_DEDUP_MS = 400;

/**
 * Dispatch entitlements:updated once per short window (preview → full upgrade).
 * @param {{ source?: string, reason?: string }} [meta]
 * @returns {boolean} true if event was dispatched
 */
export function notifyEntitlementsUpdated(meta = {}) {
  if (typeof window === "undefined") return false;
  const { source = "unknown", reason = "" } = meta;
  const now = Date.now();
  if (now - lastEntitlementsDispatchAt < ENTITLEMENTS_DEDUP_MS) {
    logStateChurn("entitlements:updated", {
      source,
      reason: reason || "dispatch",
      skipped: true,
      dedupMs: ENTITLEMENTS_DEDUP_MS,
    });
    return false;
  }
  lastEntitlementsDispatchAt = now;
  logStateChurn("entitlements:updated", { source, reason: reason || "dispatch", skipped: false });
  window.dispatchEvent(
    new CustomEvent("entitlements:updated", { detail: { source, reason, ts: now } })
  );
  return true;
}
