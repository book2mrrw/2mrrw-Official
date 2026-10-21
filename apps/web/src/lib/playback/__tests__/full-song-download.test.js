import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EncryptedSegmentStore, renditionCacheKey } from '../../audio/encrypted-segment-store.js';
import { HlsDownloadManager, parseEncryptedRendition, parseVariants } from '../../audio/hls-download-manager.js';
import { clearSegmentCache } from '../../audio/hls-segment-cache.js';

const segment = (name, version = '1') => `https://cdn.test/${name}.ts?v=${version}`;
const variant = (name = 'low', version = '1') => `https://site.test/api/variant?slug=song&bitrate=${name}&v=${version}&token=fresh`;
const data = () => new Uint8Array([1, 2, 3, 4]).buffer;
const playlist = urls => `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://site.test/key?token=secret"\n${urls.map(u => '#EXTINF:6,\n' + u).join('\n')}\n#EXT-X-ENDLIST`;
function storage() {
  const values = new Map();
  return { values, open: async () => ({
    match: async key => values.get(typeof key === 'string' ? key : key.url)?.clone(),
    put: async (key, response) => values.set(key, response.clone()),
    delete: async key => values.delete(key),
    keys: async () => [...values.keys()].map(url => ({ url })),
  }) };
}
beforeEach(clearSegmentCache);
const managers = [];
afterEach(() => managers.splice(0).forEach(m => m.stop()));

test('encrypted song survives a new store instance; token renewal reuses bytes but replacement version cannot', async () => {
  const disk = storage();
  const store = new EncryptedSegmentStore({ storage: disk });
  const urls = [segment('one'), segment('two')];
  await store.remember(variant(), urls);
  await store.put(urls[0], data());
  assert.equal(await store.complete(variant()), false);
  await store.put(urls[1], data());
  clearSegmentCache();
  const reloaded = new EncryptedSegmentStore({ storage: disk });
  assert.equal(await reloaded.complete(variant().replace('fresh', 'new-token')), true);
  assert.equal(await reloaded.complete(variant('low', '2')), false);
  assert.equal(await reloaded.has(segment('one', '2')), false);
  const saved = await Promise.all([...disk.values.values()].map(r => r.clone().text()));
  assert.equal(saved.join('').includes('secret'), false);
  assert.equal([...disk.values.keys()].some(key => key.includes('token=')), false);
});

test('readiness is recomputed after eviction; missing one segment never advertises a complete song', async () => {
  const disk = storage();
  const store = new EncryptedSegmentStore({ storage: disk });
  const urls = [segment('one'), segment('two')];
  await store.remember(variant(), urls);
  for (const url of urls) await store.put(url, data());
  assert.equal(await store.complete(variant()), true);
  disk.values.delete(urls[1]); clearSegmentCache();
  assert.equal(await store.complete(variant()), false);
});

test('bounded storage protects active bytes, rejects excess and never destroys playback on quota failure', async () => {
  const disk = storage();
  const store = new EncryptedSegmentStore({ storage: disk, maxBytes: 8 });
  store.protect([segment('active')]);
  await store.put(segment('old'), data());
  await store.put(segment('active'), data());
  await store.put(segment('new'), data());
  assert.equal(disk.values.has(segment('old')), false);
  assert.equal(disk.values.has(segment('active')), true);
  assert.equal(await store.put(segment('oversized'), new ArrayBuffer(9)), false);
  const unavailable = new EncryptedSegmentStore({ storage: { open: async () => { throw new Error('denied'); } } });
  assert.equal(await unavailable.put(segment('memory'), data()), false);
  assert.deepEqual(new Uint8Array(await unavailable.get(segment('memory'))), new Uint8Array(data()));
});

test('legacy addresses remain memory-only and never qualify a persistent replay', async () => {
  const disk = storage(); const store = new EncryptedSegmentStore({ storage: disk });
  assert.equal(renditionCacheKey('https://site.test/variant?token=secret'), null);
  await store.put('https://cdn.test/old.ts', data());
  assert.equal(disk.values.size, 0);
  assert.equal(await store.complete('https://site.test/variant?token=secret'), false);
});

test('playlist validation excludes live, plaintext, unsupported init/ranges and resolves relative encrypted URLs', () => {
  assert.deepEqual(parseEncryptedRendition(playlist(['one.ts?v=1']), 'https://cdn.test/a/list'), [segment('a/one')]);
  for (const body of [playlist([segment('one')]).replace('#EXT-X-ENDLIST', ''),
    '#EXTM3U\none.ts\n#EXT-X-ENDLIST', playlist([segment('one')]).replace('AES-128', 'NONE'),
    playlist([segment('one')]).replace('#EXTINF:6,', '#EXT-X-MAP:URI="init.mp4"'),
    playlist([segment('one')]).replace('#EXTINF:6,', '#EXT-X-BYTERANGE:4@0')]) {
    assert.throws(() => parseEncryptedRendition(body, 'https://cdn.test/list'));
  }
  assert.equal(parseVariants('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nlow\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nhigh', 'https://site.test/')[0].url, 'https://site.test/high');
});

function harness() {
  const disk = storage(); const store = new EncryptedSegmentStore({ storage: disk });
  const calls = [];
  const sources = new Map([
    [variant(), playlist([segment('low-1'), segment('low-2')])],
    [variant('high'), playlist([segment('high-1'), segment('high-2')])],
    ['/next', `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\n${variant('next')}`],
    [variant('next'), playlist([1, 2, 3, 4].map(i => segment(`next-${i}`)))],
  ]);
  const audio = Object.assign(new EventTarget(), { paused: false, ended: false, readyState: 3,
    currentTime: 0, duration: 180, buffered: { length: 1, start: () => 0, end: () => 30 } });
  const manager = new HlsDownloadManager({ store, fetcher: async (url, { signal }) => {
    calls.push(url); if (signal.aborted) throw new Error('aborted');
    return new Response(sources.get(url) ?? data());
  } });
  managers.push(manager);
  manager.begin(audio, variant(), variant('high'));
  const tick = async () => { clearTimeout(manager.timer); manager.timer = null; await manager.tick(); };
  return { manager, store, disk, calls, audio, tick };
}

test('scheduler finishes the selected song, then next opening, then warms high without swapping active media', async () => {
  const h = harness(); h.manager.queueNext('/next');
  for (let i = 0; i < 20; i++) await h.tick();
  const segments = h.calls.filter(url => url.startsWith('https://cdn.test'));
  assert.deepEqual(segments, ['low-1', 'low-2', 'next-1', 'next-2', 'next-3', 'high-1', 'high-2'].map(name => segment(name)));
  assert.equal(await h.store.complete(variant('high')), true);
  assert.equal(h.audio.currentTime, 0);
  assert.equal(h.audio.src, undefined);
});

test('buffer exhaustion, pause, and foreground decoder requests suspend background work', async () => {
  const h = harness();
  h.audio.buffered.end = () => 2; await h.tick(); assert.equal(h.calls.length, 0);
  h.audio.buffered.end = () => 30; h.audio.paused = true; await h.tick(); assert.equal(h.calls.length, 0);
  h.audio.paused = false;
  const owner = Symbol(); h.manager.foregroundStart(owner); await h.tick(); assert.equal(h.calls.length, 0);
  h.manager.foregroundEnd(owner); await h.tick(); assert.equal(h.calls.length, 1);
});

test('decoder demand aborts an in-flight warm request and a stopped generation cannot write late bytes', async () => {
  const h = harness(); let release; let captured;
  h.manager.fetcher = (url, { signal }) => { captured = signal; return new Promise(resolve => { release = resolve; }); };
  const pending = h.tick(); await Promise.resolve();
  h.manager.foregroundStart(Symbol()); assert.equal(captured.aborted, true);
  h.manager.stop(); release(new Response(playlist([segment('stale')]))); await pending;
  assert.equal(h.disk.values.size, 0);
});

test('repeated warm failures are bounded and never fall through to higher-quality traffic', async () => {
  const h = harness(); h.manager.fetcher = async () => { throw new Error('offline'); };
  for (let i = 0; i < 8; i++) await h.tick();
  assert.equal(h.manager.session.selected.errors, 3);
  assert.equal(h.manager.session.selected.failed, true);
  assert.equal(h.manager.session.high.urls, undefined);
});

test('stalled response bodies abort at the download deadline and release the scheduler', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); let aborted = false;
  h.manager.fetcher = async (url, { signal }) => ({ ok: true, url,
    arrayBuffer: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      aborted = true; reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true })),
  });
  const pending = h.tick();
  for (let i=0;i<8;i++) await Promise.resolve();
  t.mock.timers.tick(12000);
  await pending;
  assert.equal(aborted, true);
  assert.equal(h.manager.running, false);
});

test('concurrent cache owners enforce the shared budget under the browser write lock', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let queue = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{locks:{request:(name,run)=>{
    const result=queue.then(run); queue=result.catch(()=>{}); return result;
  }}}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;});
  const disk=storage();
  const first=new EncryptedSegmentStore({storage:disk,maxBytes:8});
  const second=new EncryptedSegmentStore({storage:disk,maxBytes:8});
  await Promise.all([first.put(segment('first'),data()),second.put(segment('second'),data())]);
  await Promise.all([first.put(segment('third'),data()),second.put(segment('fourth'),data())]);
  assert.equal(disk.values.size,2);
  let total=0;for(const response of disk.values.values())total+=(await response.clone().arrayBuffer()).byteLength;
  assert.equal(total,8);
});
