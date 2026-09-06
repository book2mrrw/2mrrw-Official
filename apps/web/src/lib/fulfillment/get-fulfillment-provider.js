import { FulfillmentPort } from "@/lib/fulfillment/ports/FulfillmentPort";
import { PrintfulFulfillmentAdapter } from "@/lib/fulfillment/adapters/PrintfulFulfillmentAdapter";

let singleton = null;

/**
 * The one centralized place that decides which adapter backs the
 * FulfillmentPort — mirrors wireProductionCore.js's role for playback-core.
 * Every route/webhook calls getFulfillmentProvider(), never a specific
 * adapter class directly. Swapping to a direct-manufacturer relationship
 * later means writing a new adapter implementing the same 4 methods and
 * changing only this file.
 */
export function getFulfillmentProvider() {
  if (!singleton) {
    singleton = new FulfillmentPort(
      new PrintfulFulfillmentAdapter({ apiKey: process.env.PRINTFUL_API_KEY })
    );
  }
  return singleton;
}

/** Test-only: reset the lazy singleton so a fresh provider can be injected. */
export function __resetFulfillmentProviderForTests() {
  singleton = null;
}
