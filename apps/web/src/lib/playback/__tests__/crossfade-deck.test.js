import assert from 'node:assert/strict';
import { test, mock, beforeEach, afterEach } from 'node:test';

let hlsResult, quality, instances, progressive, element;
class Hls {
  constructor() { instances.push(this); this.detached = 0; }
  setQualityLevel(value) { quality = value; }
  async loadTrack(url, target, options) { this.url = url; this.target = target; this.options = options; return hlsResult; }
  detach() { this.detached++; }
}
mock.module('../../audio/HLSEngine.js', { namedExports: { HLSEngine: Hls } });
mock.module('../../audio/network-quality.js', { namedExports: { getQualityLevel: async () => -1, getManifestTimeoutMs: () => 3000 } });
mock.module('../../audio/audio-element-utils.js', { namedExports: {
  waitAudioSrcReady: async (el, src) => { progressive.push(src); el.src = src; },
} });
const { prepareDeck } = await import('../crossfade/deck.js');
class Media extends EventTarget {
  constructor() {
    super(); Object.assign(this, { currentTime: 0, duration: 100, readyState: 4, paused: true,
      muted: false, resets: 0, plays: 0, src: 'old',
      buffered: { length: 1, start: () => 0, end: () => 12 } });
  }
  pause() { this.paused = true; }
  async play() { this.paused = false; this.plays++; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.resets++; }
}
const candidate = () => ({ abort: new AbortController(), next: {
  id: 'release:track', slug: 'release', src: '/api/library/stream?slug=release&redirect=1&trackSlug=track',
  metadata: { trackSlug: 'track', access: { canStream: true } },
} });
const engine = { getStandbyElement: () => element };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { hlsResult = true; quality = null; instances = []; progressive = []; element = new Media(); });
afterEach(() => mock.timers.reset());

test('preparation uses canonical track-qualified HLS with Auto ABR, and never starts audible playback', async () => {
  const c = candidate(); const deck = await prepareDeck(engine, c);
  assert.equal(instances[0].url, '/api/library/hls?slug=release&trackSlug=track');
  assert.equal(quality, -1); assert.equal(instances[0].options.startPosition, 0);
  assert.equal(element.plays, 0); assert.equal(element.muted, true); assert.equal(deck.ready(), true);
  assert.equal(await deck.prime(), true); assert.equal(element.muted, true);
  deck.release();
});
test('missing HLS falls back to the authenticated preload endpoint, without a new stream session', async () => {
  hlsResult = false;
  const deck = await prepareDeck(engine, candidate());
  const url = new URL(progressive[0], 'https://example.test');
  assert.equal(url.pathname, '/api/library/stream');
  assert.equal(url.searchParams.get('slug'), 'release');
  assert.equal(url.searchParams.get('trackSlug'), 'track');
  assert.equal(url.searchParams.get('preload'), '1');
  assert.equal(url.searchParams.get('redirect'), '1');
  assert.equal(deck.hls, null); deck.release();
});
test('progressive preparation preserves an already resolved source', async () => {
  const c = candidate(); c.next.src = 'https://media.example.test/audio.mp3';
  const deck = await prepareDeck(engine, c);
  assert.deepEqual(progressive, [c.next.src]); assert.equal(instances[0].url, undefined);
  deck.release();
});
test('abort and later cleanup are idempotent, so an old operation cannot clear a reused deck', async () => {
  const c = candidate(); const old = await prepareDeck(engine, c);
  c.abort.abort(); const resets = element.resets;
  element.src = 'successor'; old.release();
  assert.equal(element.resets, resets); assert.equal(element.src, 'successor');
});
test('ownership transfer prevents late abort/release from pausing the new active track', async () => {
  const c = candidate(); const deck = await prepareDeck(engine, c); await deck.prime();
  deck.transfer(); c.abort.abort(); deck.release();
  assert.equal(element.paused, false); assert.equal(element.resets, 0);
});
test('readiness timeout is failure, never permission to fade', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  element.readyState = 1;
  const waiting = prepareDeck(engine, candidate()); await flush();
  mock.timers.tick(6000); await flush();
  assert.equal(await waiting, null); assert.equal(element.plays, 0);
});
test('already-aborted work allocates and loads nothing', async () => {
  const c = candidate(); c.abort.abort();
  assert.equal(await prepareDeck(engine, c), null);
  assert.equal(instances.length, 0); assert.equal(element.resets, 0);
});
