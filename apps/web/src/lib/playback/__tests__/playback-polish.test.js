import test from 'node:test';
import assert from 'node:assert/strict';
import { hlsDownloadManager as manager } from '../../audio/hls-download-manager.js';
import { encryptedSegmentStore as sharedStore, EncryptedSegmentStore } from '../../audio/encrypted-segment-store.js';
import { clearSegmentCache } from '../../audio/hls-segment-cache.js';
import { createPrefetchLoaderClass, memoryDeliveredStats } from '../../audio/hls-prefetch-loader.js';

const url = 'https://cdn.test/song/low/one.ts?v=1';
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function borrowing(t) {
  clearSegmentCache();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = { store: manager.store, fetcher: manager.fetcher, storage: sharedStore.storage };
  sharedStore.storage = null;
  manager.store = { protect() {}, has: async () => false, put: async () => true };
  let resolve; let signal; let deliveries = 0; let networks = 0;
  manager.fetcher = async (address, options) => {
    signal = options.signal;
    return new Promise((done, reject) => {
      resolve = () => done(new Response(new ArrayBuffer(16)));
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  const audio = Object.assign(new EventTarget(), { paused: false, ended: false, readyState: 4,
    currentTime: 0, duration: 180, buffered: { length: 1, start: () => 0, end: () => 30 } });
  manager.begin(audio, 'https://site.test/variant?v=1', null);
  clearTimeout(manager.timer); manager.timer = null;
  manager.session.selected.urls = [url];
  const pending = manager.tick();
  class Network {
    constructor() { this.stats = {}; }
    load(context, config, callbacks) { networks++; callbacks.onSuccess({ data: new ArrayBuffer(16) }, this.stats, context, null); }
    abort() {} destroy() {}
  }
  const Loader = createPrefetchLoaderClass(Network);
  const loader = new Loader({});
  let stats;
  t.after(() => { loader.destroy(); manager.stop(); Object.assign(manager, { store: original.store, fetcher: original.fetcher }); sharedStore.storage = original.storage; clearSegmentCache(); });
  return { audio, pending, loader, get signal() { return signal; }, finish: () => resolve(),
    load: () => loader.load({ url }, {}, { onSuccess: (_, value) => { deliveries++; stats = value; } }),
    get deliveries() { return deliveries; }, get networks() { return networks; }, get stats() { return stats; } };
}

test('decoder reuses an exact in-flight segment, including while buffering, without a duplicate request', async t => {
  const h = borrowing(t); await flush(); h.load();
  h.audio.readyState = 2; h.audio.dispatchEvent(new Event('waiting'));
  assert.equal(h.signal.aborted, false);
  h.finish(); await h.pending; await flush();
  assert.equal(h.deliveries, 1); assert.equal(h.networks, 0);
  assert.equal(memoryDeliveredStats.has(h.stats), true, 'partial-transfer timing must not train ABR');
});

test('a slow borrowed transfer is abandoned once and falls back to the normal decoder loader', async t => {
  const h = borrowing(t); await flush(); h.load();
  t.mock.timers.tick(100); await flush(); await h.pending;
  assert.equal(h.signal.aborted, true);
  assert.equal(h.networks, 1); assert.equal(h.deliveries, 1);
  t.mock.timers.tick(12000); await flush();
  assert.equal(h.networks, 1);
});

test('abort during a borrowed transfer never delivers stale bytes or starts fallback', async t => {
  const h = borrowing(t); await flush(); h.load(); h.loader.abort();
  h.finish(); await h.pending; await flush();
  assert.equal(h.deliveries, 0); assert.equal(h.networks, 0);
});

test('a primed known miss bypasses disk, while an unknown urgent lookup falls back at 40 ms', async t => {
  clearSegmentCache(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = { storage: sharedStore.storage, inventory: sharedStore.inventory, inventoryAt: sharedStore.inventoryAt };
  let matches = 0; let loads = 0;
  sharedStore.storage = { open: async () => ({ keys: async () => [], match: () => { matches++; return new Promise(() => {}); } }) };
  t.after(() => { Object.assign(sharedStore, old); manager.stop(); });
  await sharedStore.prepare();
  class Network { constructor() { this.stats = {}; } load() { loads++; } destroy() {} }
  const Loader = createPrefetchLoaderClass(Network);
  const first = new Loader({}); first.load({ url }, {}, {});
  assert.equal(loads, 1); assert.equal(matches, 0); first.destroy();
  sharedStore.inventory = null;
  const second = new Loader({}); second.load({ url }, {}, {}); await flush();
  t.mock.timers.tick(39); await flush(); assert.equal(loads, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(loads, 2); second.destroy();
});

test('readiness checks run in groups of eight and still reject a missing or replaced segment', async t => {
  clearSegmentCache(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const urls = Array.from({ length: 10 }, (_, i) => `https://cdn.test/song/${i}.ts?v=1`);
  let missing = null; let active = 0; let maximum = 0;
  const store = new EncryptedSegmentStore({ storage: { open: async () => ({ match: async address => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 70)); active--;
    return address === missing ? undefined : new Response(new ArrayBuffer(16), { headers: { 'x-2mrrw-bytes': '16' } });
  } }) } });
  const key = 'https://site.test/variant?slug=song&v=1'; store.catalog.set(key, urls);
  const check = async () => {
    let settled = false;
    const pending = store.complete(key).then(value => { settled = true; return value; }); await flush();
    t.mock.timers.tick(70); await flush(); t.mock.timers.tick(70); await flush();
    assert.equal(settled, true, 'all ten storage checks complete in two 70 ms batches');
    return pending;
  };
  assert.equal(await check(), true); assert.equal(maximum, 8);
  missing = urls[9]; assert.equal(await check(), false);
  const replaced = store.complete(key.replace('v=1', 'v=2')); await flush();
  t.mock.timers.tick(70); await flush();
  assert.equal(await replaced, false);
});
