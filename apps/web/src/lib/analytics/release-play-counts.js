/**
 * Lifetime fan plays per release for the storefront's release cards.
 *
 * Read with the catalog on the server (catalog-db), so the count is part of
 * each card's data at first render — no client fetch, no extra render. One
 * indexed SQL count (release_play_counts, migration 20261120000000) cached
 * for a minute per server instance; the catalog-refresh revision does not
 * include counts, so a new play never triggers a storefront refresh.
 * Any failure leaves counts out (cards simply show none) — never an error.
 */
import { isMissingFunction } from "@/lib/analytics/range";

export const PLAY_COUNT_TTL_MS = 60_000;

let cached = { at: 0, counts: null };
let inflight = null;

export function resetPlayCountCache() {
  cached = { at: 0, counts: null };
  inflight = null;
}

export async function getReleasePlayCounts(admin, now = Date.now()) {
  if (cached.counts && now - cached.at < PLAY_COUNT_TTL_MS) return cached.counts;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await admin.rpc("release_play_counts");
      if (error) {
        if (!isMissingFunction(error)) console.warn("[play-counts] unavailable:", error.message);
        return cached.counts || new Map();
      }
      const counts = new Map((data || []).map((row) => [row.product_id, Number(row.plays) || 0]));
      cached = { at: now, counts };
      return counts;
    } catch (err) {
      console.warn("[play-counts] unavailable:", err?.message);
      return cached.counts || new Map();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The card's count for a catalog row (0 when it has no plays yet). */
export function playCountFor(counts, productId) {
  return (productId && counts?.get(productId)) || 0;
}
