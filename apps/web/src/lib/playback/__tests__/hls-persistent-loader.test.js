import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptedSegmentStore as store } from '../../audio/encrypted-segment-store.js';
import { clearSegmentCache } from '../../audio/hls-segment-cache.js';
import { createPrefetchLoaderClass, memoryDeliveredStats } from '../../audio/hls-prefetch-loader.js';
import { hlsDownloadManager } from '../../audio/hls-download-manager.js';

test('a network decoder load retains encrypted bytes before transfer; a later loader reads persistent storage', async t => {
  clearSegmentCache();
  const old = { storage: store.storage, entries: store.entries, writes: store.writes,
    inventory: store.inventory, inventoryAt: store.inventoryAt };
  const values = new Map();
  store.storage = { open: async () => ({ keys: async () => [...values.keys()].map(url => ({ url })),
    match: async url => values.get(url)?.clone(),
    put: async (url, response) => values.set(url, response.clone()), delete: async url => values.delete(url),
  }) };
  store.entries = null;
  t.after(async () => { await store.preparing; Object.assign(store, old); clearSegmentCache(); hlsDownloadManager.stop(); });
  let loads = 0;
  class NetworkLoader {
    constructor() { this.stats = {}; }
    load(context, config, callbacks) {
      loads++;
      callbacks.onSuccess({ data: new Uint8Array([4, 3, 2, 1]).buffer }, this.stats, context, null);
    }
    destroy() {}
  }
  const Loader = createPrefetchLoaderClass(NetworkLoader);
  const url = 'https://cdn.test/album/320k/segment.ts?v=release-one';
  const load = () => new Promise(resolve => new Loader({}).load({ url }, {}, {
    onSuccess: (response, stats) => resolve({ response, stats }),
  }));
  const first = await load();
  assert.equal(memoryDeliveredStats.has(first.stats), false);
  structuredClone(first.response.data, { transfer: [first.response.data] });
  await store.writes;
  clearSegmentCache();
  const second = await load();
  assert.deepEqual([...new Uint8Array(second.response.data)], [4, 3, 2, 1]);
  assert.equal(memoryDeliveredStats.has(second.stats), true);
  assert.equal(loads, 1);
  assert.equal(hlsDownloadManager.foreground.size, 0);
});

test('aborting during persistent lookup prevents late cache delivery and network fallback', async t => {
  clearSegmentCache();
  const old = { storage: store.storage, inventory: store.inventory, inventoryAt: store.inventoryAt };
  store.inventory = null;
  let release;
  store.storage = { open: async () => ({ match: () => new Promise(resolve => { release = resolve; }) }) };
  t.after(async () => { await store.preparing; Object.assign(store, old); hlsDownloadManager.stop(); });
  let delivered = false; let network = false;
  class NetworkLoader { load() { network = true; } abort() {} }
  const Loader = createPrefetchLoaderClass(NetworkLoader);
  const loader = new Loader({});
  loader.load({ url: 'https://cdn.test/late.ts?v=1' }, {}, { onSuccess: () => { delivered = true; } });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  loader.abort();
  release(new Response(new Uint8Array([1]).buffer));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(delivered, false);
  assert.equal(network, false);
  assert.equal(hlsDownloadManager.foreground.size, 0);
});
