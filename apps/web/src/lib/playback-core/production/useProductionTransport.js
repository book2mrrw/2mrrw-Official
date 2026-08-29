"use client";

import { getProductionPlaybackCore } from "./wireProductionCore.js";

// Production-only React boundary. Calling a hook initializes the already
// synchronously wired Core and subscribes directly to its independent store.
export function useProductionTransportStatus(selector) {
  return getProductionPlaybackCore().reactAdapter.useTransportStatus(selector);
}

export function useProductionTransportTimeline(selector) {
  return getProductionPlaybackCore().reactAdapter.useTransportTimeline(selector);
}

export function useProductionTransportMode(selector) {
  return getProductionPlaybackCore().reactAdapter.useTransportMode(selector);
}
