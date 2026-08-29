"use client";

import { getProductionPlaybackCore } from "./wireProductionCore.js";

// Production-only React boundary. Calling this hook initializes the already
// synchronously wired Core and subscribes directly to its independent
// Selection store (NowPlaying + Queue + QueueIndex commit atomically — one
// subscription, one snapshot, never a torn read across the three).
export function useProductionSelection(selector) {
  return getProductionPlaybackCore().reactAdapter.useSelection(selector);
}
