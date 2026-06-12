/**
 * Centralized playback/resolver cache invalidation.
 *
 * Server-side only (entity-resolver + stream-url-cache run in API routes).
 * Client playback position keys live in localStorage — see position-memory.js;
 * they are slug-scoped and safe to keep (no path strings stored).
 *
 * Manual / test usage:
 *   import { clearMediaResolverCaches } from "@/lib/media/cache-invalidation";
 *   clearMediaResolverCaches();
 */

import {
  clearCanonicalCatalogCache,
  rebuildCanonicalCatalogMappings,
} from "@/lib/media/canonical-catalog";
import { clearEntityResolverCaches } from "@/lib/media/entity-resolver";
import { clearMediaAvailabilityCache } from "@/lib/media/availability-cache";
import { clearPlaybackKeyCache } from "@/lib/playback/resolve-playback-key";
import { clearPreviewResolutionCache } from "@/lib/playback/preview-resolution-cache";
import { clearStreamUrlCache } from "@/lib/playback/stream-url-cache";

/** Clear all resolver memoization used on the playback path (does not touch localStorage). */
export function clearMediaResolverCaches() {
  clearEntityResolverCaches();
  clearMediaAvailabilityCache();
  clearStreamUrlCache();
  clearPlaybackKeyCache();
  clearPreviewResolutionCache();
  clearCanonicalCatalogCache();
}

export { rebuildCanonicalCatalogMappings };
