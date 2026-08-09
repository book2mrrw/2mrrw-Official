/**
 * Custom hls.js fragment loader factory for preloaded segment delivery.
 *
 * When a segment URL is in the in-memory segment cache (pre-fetched during
 * next-track preload), the loader serves the cached ArrayBuffer with zero
 * network latency. On a cache miss, falls through to the default hls.js
 * loader — all retry logic, timeouts, and CORS handling are inherited.
 *
 * Used as the `fLoader` config option so ONLY fragment (segment) loads are
 * intercepted. Manifest, variant-playlist, and key requests are unaffected.
 *
 * ABR note: cache-hit loads report bwEstimate: 0. hls.js ignores zero
 * estimates in its EWMA, so the ABR algorithm is only calibrated by real
 * CDN loads after the preloaded segments are consumed.
 */

import { getSegment } from "./hls-segment-cache";

let _cachedClass = null;

/**
 * Returns a singleton hls.js loader class that checks the segment cache
 * before delegating to the built-in XHR loader.
 *
 * @param {Function} DefaultLoaderClass - Hls.DefaultConfig.loader (XhrLoader)
 * @returns {Function} Constructor for the custom loader
 */
export function createPrefetchLoaderClass(DefaultLoaderClass) {
  if (_cachedClass) return _cachedClass;

  _cachedClass = class HlsPrefetchLoader extends DefaultLoaderClass {
    constructor(config) {
      super(config);
    }

    load(context, config, callbacks) {
      const buf = getSegment(context.url);
      if (!buf) {
        // Cache miss — preserve all default retry / timeout behavior.
        super.load(context, config, callbacks);
        return;
      }

      // Cache hit — serve pre-fetched bytes with zero network latency.
      // queueMicrotask keeps the call asynchronous so hls.js internal state
      // is consistent when onSuccess fires (matching XHR async delivery).
      const now = performance.now();
      const stats = {
        aborted: false,
        loaded: buf.byteLength,
        retry: 0,
        total: buf.byteLength,
        chunkCount: 1,
        // bwEstimate intentionally omitted (undefined). hls.js's ABR EWMA only
        // incorporates samples with a defined, non-zero estimate — undefined is
        // treated as "no bandwidth data" and skipped entirely. Supplying 0 could
        // be interpreted as a valid 0 bps measurement in some hls.js versions,
        // pushing the EWMA toward the lowest bitrate tier for the first 1-2 CDN
        // segments after the preloaded cache is consumed.
        loading: { start: now, first: now, end: now },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, end: 0 },
      };
      queueMicrotask(() => {
        callbacks.onSuccess({ url: context.url, data: buf }, stats, context, null);
      });
    }
  };

  return _cachedClass;
}
