/**
 * Phase 5.2 Stage 4 — Shadow validation metrics for playback resolver.
 * Server-side only; no polling loops. Safe to log — no secrets.
 */

const DEBUG_RESOLVER =
  process.env.R2_STREAM_DEBUG === "1" || process.env.NODE_ENV === "development";

/** @type {{ total: number, stream: number, master: number, preview: number, fallbacks: number, durationSumMs: number, fallbacksByReason: Record<string, number> }} */
const counters = {
  total: 0,
  stream: 0,
  master: 0,
  preview: 0,
  fallbacks: 0,
  durationSumMs: 0,
  fallbacksByReason: {},
};

/**
 * Record one resolver outcome (stream hit, master fallback, or preview path).
 *
 * @param {{
 *   result: "stream" | "master" | "preview",
 *   durationMs?: number,
 *   fallbackReason?: string | null,
 * }} outcome
 */
export function recordPlaybackResolverOutcome(outcome) {
  const { result, durationMs = 0, fallbackReason = null } = outcome;
  counters.total += 1;
  counters.durationSumMs += Math.max(0, durationMs);

  if (result === "stream") counters.stream += 1;
  else if (result === "master") counters.master += 1;
  else if (result === "preview") counters.preview += 1;

  if (fallbackReason) {
    counters.fallbacks += 1;
    counters.fallbacksByReason[fallbackReason] =
      (counters.fallbacksByReason[fallbackReason] || 0) + 1;
  }

  if (DEBUG_RESOLVER) {
    console.info("[playback-resolver]", {
      result,
      durationMs: Math.round(durationMs * 10) / 10,
      fallbackReason: fallbackReason || null,
      streamHitRate: counters.total ? counters.stream / counters.total : 0,
      fallbackRate: counters.total ? counters.fallbacks / counters.total : 0,
    });
  }
}

/**
 * Snapshot of resolver shadow metrics for dev/admin diagnostics.
 *
 * @returns {{
 *   total: number,
 *   stream: number,
 *   master: number,
 *   preview: number,
 *   fallbacks: number,
 *   streamHitRate: number,
 *   fallbackRate: number,
 *   avgDurationMs: number,
 *   fallbacksByReason: Record<string, number>,
 * }}
 */
export function getPlaybackResolverDiagnostics() {
  const total = counters.total;
  return {
    total,
    stream: counters.stream,
    master: counters.master,
    preview: counters.preview,
    fallbacks: counters.fallbacks,
    streamHitRate: total ? Math.round((counters.stream / total) * 1000) / 1000 : 0,
    fallbackRate: total ? Math.round((counters.fallbacks / total) * 1000) / 1000 : 0,
    avgDurationMs: total ? Math.round((counters.durationSumMs / total) * 10) / 10 : 0,
    fallbacksByReason: { ...counters.fallbacksByReason },
  };
}

/** Reset counters (tests / hot reload). */
export function resetPlaybackResolverDiagnostics() {
  counters.total = 0;
  counters.stream = 0;
  counters.master = 0;
  counters.preview = 0;
  counters.fallbacks = 0;
  counters.durationSumMs = 0;
  counters.fallbacksByReason = {};
}
