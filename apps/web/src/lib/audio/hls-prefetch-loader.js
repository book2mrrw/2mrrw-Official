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
 * Cache statistics retain their identity and carry delivery provenance so the
 * paired ABR controller excludes memory delivery from network measurements.
 */

import { getSegment } from "./hls-segment-cache";
import { encryptedSegmentStore } from "./encrypted-segment-store";
import { hlsDownloadManager } from "./hls-download-manager";

export const memoryDeliveredStats = new WeakSet();
const classes = new WeakMap();

/**
 * Returns a singleton hls.js loader class that checks the segment cache
 * before delegating to the built-in XHR loader.
 *
 * @param {Function} DefaultLoaderClass - Hls.DefaultConfig.loader (XhrLoader)
 * @returns {Function} Constructor for the custom loader
 */
export function createPrefetchLoaderClass(DefaultLoaderClass) {
  if (classes.has(DefaultLoaderClass)) return classes.get(DefaultLoaderClass);

  const Loader = class HlsPrefetchLoader extends DefaultLoaderClass {
    constructor(config) {
      super(config);
      this._deliveryGeneration = 0;
    }

    load(context, config, callbacks) {
      const generation = ++this._deliveryGeneration;
      const memory = getSegment(context.url);
      if (memory) { this._deliverCached(memory, context, callbacks, generation); return; }
      this._endForeground?.();
      const owner = Symbol('decoder-fragment');
      hlsDownloadManager.foregroundStart(owner);
      const end = () => hlsDownloadManager.foregroundEnd(owner);
      this._endForeground = end;
      const network = () => {
        if (generation !== this._deliveryGeneration) { end(); return; }
        memoryDeliveredStats.delete(this.stats);
        super.load(context, config, {
          ...callbacks,
          onSuccess: (response, stats, ...rest) => {
            // Snapshot encrypted bytes before hls.js transfers them to its worker.
            if (response.data instanceof ArrayBuffer) void encryptedSegmentStore.put(context.url, response.data);
            end();
            callbacks.onSuccess(response, stats, ...rest);
          },
          onError: (...args) => { end(); callbacks.onError?.(...args); },
          onTimeout: (...args) => { end(); callbacks.onTimeout?.(...args); },
          onAbort: (...args) => { end(); callbacks.onAbort?.(...args); },
        });
      };
      if (!encryptedSegmentStore.storage) { network(); return; }
      encryptedSegmentStore.get(context.url).then(buf => {
        if (generation !== this._deliveryGeneration) { end(); return; }
        if (buf) { end(); this._deliverCached(buf, context, callbacks, generation); }
        else network();
      }).catch(network);
    }

    _deliverCached(buf, context, callbacks, generation) {
      // Cache hit — serve pre-fetched bytes with zero network latency.
      // queueMicrotask keeps the call asynchronous so hls.js internal state
      // is consistent when onSuccess fires (matching XHR async delivery).
      const now = performance.now();
      const stats = this.stats || (this.stats = {});
      Object.assign(stats, {
        aborted: false, loaded: buf.byteLength, retry: 0,
        total: buf.byteLength, chunkCount: 1,
        loading: { start: now, first: now, end: now },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, end: 0 },
      });
      memoryDeliveredStats.add(stats);
      queueMicrotask(() => {
        if (generation !== this._deliveryGeneration || stats.aborted) return;
        callbacks.onSuccess({ url: context.url, data: buf }, stats, context, null);
      });
    }

    abort() {
      this._deliveryGeneration++;
      this._endForeground?.();
      super.abort();
    }

    destroy() {
      this._deliveryGeneration++;
      this._endForeground?.();
      super.destroy();
    }
  };

  classes.set(DefaultLoaderClass, Loader);
  return Loader;
}
