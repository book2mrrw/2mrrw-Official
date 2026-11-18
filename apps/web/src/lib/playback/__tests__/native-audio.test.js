import assert from 'node:assert/strict';
import test from 'node:test';
import { isNativeAudioElement, nativeAudioPlatform, nativeUpcoming } from '../native-audio.js';

const queue = ['a', 'b', 'c', 'd'].map((slug) => ({ slug }));
const slugs = (result) => [result.tracks.map((t) => t.slug).join(','), result.repeat];

test('native plays on in queue order, wrapping only with repeat all', () => {
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 1 })), ['c,d', 'off']);
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 1, repeatMode: 'all' })), ['c,d', 'all']);
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 3 })), ['', 'off']);
});

test('repeat one, stop-after-each and the sleep timer leave nothing to advance to', () => {
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 0, repeatMode: 'one' })), ['', 'one']);
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 0, stopAfterEachTrack: true })), ['', 'off']);
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 0, stopAfterEachTrack: true, repeatMode: 'all' })), ['b,c,d', 'all']);
  assert.deepEqual(slugs(nativeUpcoming({ queue, queueIndex: 0, sleepAfterCurrentTrack: true })), ['', 'off']);
});

test("shuffle follows the engine's established permutation from the current position", () => {
  const shuffled = { queue, queueIndex: 2, shuffle: true, shuffledOrder: [3, 2, 0, 1], shufflePosition: 1 };
  assert.deepEqual(slugs(nativeUpcoming(shuffled)), ['a,b', 'off']);
  assert.deepEqual(slugs(nativeUpcoming({ ...shuffled, shuffledOrder: null })), ['', 'off']);
  assert.deepEqual(slugs(nativeUpcoming({ ...shuffled, shufflePosition: 0 })), ['', 'off'], 'an order for another position is not trusted');
});

test('on the website there is no native platform and no element is native', () => {
  assert.equal(nativeAudioPlatform(), null);
  assert.equal(isNativeAudioElement({ tagName: 'AUDIO' }), false);
  assert.equal(isNativeAudioElement({ isNativeAudio: true }), true);
});

test("the engine's element is the app's native element, created once and never put in the DOM", async (t) => {
  const created = [];
  const native = { isNativeAudio: true };
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { __2MRRW_NATIVE_AUDIO__: { createElement: () => { created.push(native); return native; } } };
  globalThis.document = { body: { appendChild() { throw new Error('appended'); } }, createElement() { throw new Error('<audio> created'); } };
  t.after(() => { globalThis.window = saved.window; globalThis.document = saved.document; });
  const { ensureDetachedAudioElement, getAudioEngineRuntime } = await import('../audio-engine-runtime.js');
  assert.equal(ensureDetachedAudioElement(), native);
  assert.equal(ensureDetachedAudioElement(), native);
  assert.equal(created.length, 1);
  assert.equal(getAudioEngineRuntime().refs.audioRef.current, native);
});

test('HLSEngine hands a native element the adaptive master and fetches nothing itself', async (t) => {
  const { HLSEngine } = await import('../../audio/HLSEngine.js');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fetched'); });
  const engine = new HLSEngine();
  const element = { isNativeAudio: true, src: '' };
  assert.equal(await engine.loadTrack('/api/library/hls?slug=w2d', element), true);
  assert.equal(element.src, 'https://www.2mrrw.com/api/library/hls?slug=w2d');
  assert.equal(engine.isLoaded, true);
  assert.equal(engine._hls, null);
  engine.detach();
  assert.equal(engine.isLoaded, false);
});
