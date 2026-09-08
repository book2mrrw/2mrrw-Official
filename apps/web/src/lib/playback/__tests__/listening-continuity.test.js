import assert from 'node:assert/strict';
import test from 'node:test';
import { nextQueueIndex } from '../queue-order.js';
import { createPlaybackEventHandlers } from '../PlaybackEventHandlers.js';
import { getQualityLevel, getStartupQualityLevel } from '../../audio/network-quality.js';
import { HLSEngine, qualityTierLevel } from '../../audio/HLSEngine.js';
import { bufferedAhead, canPreloadAudio, waitForPlaybackBuffer } from '../../audio/playback-buffer.js';

const ref = (current) => ({ current });
const queue = Array.from({ length: 5 }, (_, i) => ({ id: `album:${i}`, slug: `track-${i}`, src: `/track-${i}.mp3`, metadata: { access: { canStream: true } } }));
const orderRefs = (shuffle = true, repeat = 'off') => ({
  shuffleRef: ref(shuffle), repeatModeRef: ref(repeat), shuffledOrderRef: ref(null), shufflePositionRef: ref(0),
});

for (const start of [0, 2, 4]) {
  test(`shuffle visits every track once from index ${start}, then stops`, () => {
    const refs = orderRefs();
    const played = [start];
    let index = start;
    for (let i = 1; i < queue.length; i++) {
      const peek = nextQueueIndex(queue, index, refs);
      assert.equal(nextQueueIndex(queue, index, refs), peek);
      index = nextQueueIndex(queue, index, refs, { advance: true });
      assert.equal(index, peek);
      played.push(index);
    }
    assert.equal(new Set(played).size, queue.length);
    assert.equal(nextQueueIndex(queue, index, refs, { advance: true }), -1);
  });
}

test('shuffle repeat-all preloads the same track it advances to across repeated cycles', () => {
  const refs = orderRefs(true, 'all');
  let index = 0;
  for (let i = 0; i < 20; i++) {
    const peek = nextQueueIndex(queue, index, refs);
    const next = nextQueueIndex(queue, index, refs, { advance: true });
    assert.equal(next, peek);
    assert.notEqual(next, index);
    index = next;
  }
});

function completionHarness(shuffle = false) {
  const refs = orderRefs(shuffle);
  const state = { currentTrack: queue[0], isPlaying: true, hasStarted: true };
  const audio = { duration: 180, currentTime: 180, ended: true, removeAttribute() {}, load() {} };
  const deps = new Proxy({
    ...refs, audio, audioRef: ref(audio), stateRef: ref(state), queueRef: ref(queue), queueIndexRef: ref(0),
    spuriousEndedGuardRef: ref(0), userPausedRef: ref(false), userIntentPausedRef: ref(false),
    csModeRef: ref(false), stopAfterEachTrackRef: ref(false), sleepTimerRef: ref({}),
    streamMetaRef: ref(null), lastPersistRef: ref({}), listeningProgressRef: ref({}),
    activeCommandRef: ref(null), nextTrackPreloadRef: ref(null),
    patchState(patch) { Object.assign(state, patch); },
    advanceShuffleOrder(q, i) { return nextQueueIndex(q, i, refs, { advance: true }); },
  }, { get(target, key) { return key in target ? target[key] : key.endsWith('Ref') ? ref(null) : () => {}; } });
  const played = [queue[0].id];
  deps.playTrackRef = ref((track) => {
    played.push(track.id);
    state.currentTrack = track;
    state.isPlaying = true;
    return true; // Public API returns acceptance synchronously, not a Promise.
  });
  return { deps, state, audio, played, handlers: createPlaybackEventHandlers(deps) };
}

for (const shuffle of [false, true]) {
  test(`locked-screen completion plays an entire ${shuffle ? 'shuffled' : 'ordered'} album queue`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
    const h = completionHarness(shuffle);
    for (let i = 1; i < queue.length; i++) {
      h.handlers.onEnded();
      // No React renders, animation frames or timers are serviced between tracks.
      assert.equal(h.played.length, i + 1);
    }
    assert.equal(new Set(h.played).size, queue.length);
    h.handlers.onEnded();
    assert.equal(h.played.length, queue.length);
    assert.equal(h.state.isPlaying, false);
    await Promise.resolve();
  });
}

test('late ended during a source swap never rewinds or stops the successor', () => {
  const h = completionHarness();
  h.audio.ended = false;
  h.audio.currentTime = 8;
  h.deps.spuriousEndedGuardRef.current = Date.now() + 10000;
  h.handlers.onEnded();
  assert.equal(h.audio.currentTime, 8);
  assert.equal(h.state.isPlaying, true);
  assert.equal(h.played.length, 1);
});

test('preview completion never advances to the full queue', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  const h = completionHarness();
  h.state.currentTrack = { ...queue[0], metadata: { access: { previewOnly: true } } };
  h.handlers.onEnded();
  assert.equal(h.played.length, 1);
  assert.equal(h.state.playbackState, 'ended_preview');
});

test('network hints seed startup without selecting manual bitrate, on weak and strong links', async (t) => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { connection: { effectiveType: '2g' } } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  assert.equal(await getQualityLevel(), -1);
  assert.equal(getStartupQualityLevel(), 3);
  navigator.connection.effectiveType = '4g';
  assert.equal(await getQualityLevel(), -1);
  assert.equal(getStartupQualityLevel(), 0);
  localStorage.getItem = () => '1';
  assert.equal(await getQualityLevel(), 1);
});

test('quality preference maps actual bitrate ordering and returning to Auto clears the pin', () => {
  const engine = new HLSEngine();
  engine._hls = { levels: [{ bitrate: 64000 }, { bitrate: 320000 }, { bitrate: 160000 }], currentLevel: -1 };
  engine.setQualityLevel(0);
  assert.equal(engine._hls.currentLevel, 1);
  engine.setQualityLevel(-1);
  assert.equal(engine._hls.currentLevel, -1);
  assert.equal(qualityTierLevel(engine._hls.levels, 3), 0);
});

function media(ranges = [[0, 2]]) {
  const el = new EventTarget();
  Object.assign(el, { currentTime: 0, duration: 180, readyState: 3, paused: false,
    buffered: { length: ranges.length, start: (i) => ranges[i][0], end: (i) => ranges[i][1] } });
  return el;
}

test('preloading uses real contiguous runway even without Network Information API', () => {
  assert.equal(bufferedAhead(media([[10, 30]])), 0);
  assert.equal(canPreloadAudio(media([[0, 2], [10, 90]])), false);
  assert.equal(canPreloadAudio(media([[0, 25]])), true);
  assert.equal(canPreloadAudio(media([[0, 25]]), { recentStallAt: Date.now() }), false);
});

test('locking during buffer startup releases the gate without a timer tick', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const waiting = waitForPlaybackBuffer(media(), { document: doc });
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await waiting;
});

test('repeated canplay events recheck runway and abort removes listeners', async () => {
  const el = media([[0, 1]]);
  const ac = new AbortController();
  const waiting = waitForPlaybackBuffer(el, { signal: ac.signal });
  el.dispatchEvent(new Event('canplay'));
  ac.abort();
  await waiting;
  const short = media([[0, 1]]);
  short.duration = 1;
  await waitForPlaybackBuffer(short);
});


test('duplicate ended events cannot advance twice while the next source is loading', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  const h = completionHarness();
  let requests = 0;
  h.deps.playTrackRef.current = () => { requests++; return true; };
  h.handlers.onEnded();
  h.handlers.onEnded();
  assert.equal(requests, 1);
});

for (const reason of ['userPausedRef', 'userIntentPausedRef']) {
  test(`completion respects ${reason} instead of resuming the queue`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
    const h = completionHarness();
    h.deps[reason].current = true;
    h.handlers.onEnded();
    assert.equal(h.played.length, 1);
  });
}

test('sleep after current track stops queue advancement', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  const h = completionHarness();
  h.deps.sleepTimerRef.current = { afterCurrentTrack: true };
  h.handlers.onEnded();
  assert.equal(h.played.length, 1);
  assert.equal(h.state.isPlaying, false);
});
