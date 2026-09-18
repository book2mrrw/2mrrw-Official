import assert from 'node:assert/strict';
import test from 'node:test';
import { attachQueueCommands } from '../PlaybackQueueCommands.js';
import { reduceDesiredState } from '../../playback-core/desired/DesiredStateReducer.js';
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
    activeCommandRef: ref(null), nextTrackPreloadRef: ref(null), playRequestIdRef: ref(1),
    requestAuthoritativePlay(track, options, policy) {
      deps.lastAdvancePolicy = policy;
      return deps.playTrackRef.current(track, options);
    },
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

// Real browsers emit pause before ended at the natural media boundary.
for (const [hidden, shuffle] of [[false, false], [false, true], [true, false], [true, true]]) {
  test(`natural completion does not register interruption recovery (${hidden ? 'locked' : 'visible'}, ${shuffle ? 'shuffle' : 'ordered'})`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const oldDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: hidden ? 'hidden' : 'visible' } });
    t.after(() => { if (oldDoc) Object.defineProperty(globalThis, 'document', oldDoc); else delete globalThis.document; });
    const h = completionHarness(shuffle);
    h.audio.paused = true;
    const listeners = [];
    h.audio.addEventListener = (name) => listeners.push(name);
    h.audio.removeEventListener = () => {};
    for (let i = 1; i < queue.length; i++) {
      h.handlers.onPause();
      assert.deepEqual(listeners, [], 'natural end must not attach a stale canplay resume');
      assert.equal(h.state.isPlaying, true, 'ended owns the queue handoff');
      h.handlers.onEnded();
      assert.equal(h.played.length, i + 1);
    }
    assert.equal(new Set(h.played).size, queue.length);
  });
}

test('metadata refresh during completion does not cancel the next track', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  const h = completionHarness();
  h.deps.patchState = (patch) => {
    Object.assign(h.state, patch);
    h.state.currentTrack = { ...h.state.currentTrack };
  };
  const handlers = createPlaybackEventHandlers(h.deps);
  handlers.onEnded();
  assert.equal(h.played.length, 2);
});


test('automatic playback preserves repeated playlist occurrences through Core selection', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  const h = completionHarness();
  const repeated = [queue[0], queue[0], queue[1], queue[0], queue[2]];
  h.deps.queueRef.current = repeated;
  const selected = [];
  h.deps.requestAuthoritativePlay = (track, options, policy) => {
    const desired = reduceDesiredState({}, { type: 'PLAY', ...policy, options });
    selected.push(policy.queueIndex);
    assert.equal(desired.requestedMediaEntry, repeated[policy.queueIndex]);
    assert.equal(policy.source, 'autoplay');
    assert.equal(policy.requireCurrentPlaying, true);
    h.state.currentTrack = desired.requestedMediaEntry;
    h.deps.playRequestIdRef.current++;
    return true;
  };
  const handlers = createPlaybackEventHandlers(h.deps);
  for (let i = 1; i < repeated.length; i++) handlers.onEnded();
  assert.deepEqual(selected, [1, 2, 3, 4]);
});

test('a replacement play request wins even when it selects the same track', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  const h = completionHarness();
  h.deps.patchState = (patch) => {
    Object.assign(h.state, patch);
    if (patch.playbackState === 'ending') h.deps.playRequestIdRef.current++;
  };
  createPlaybackEventHandlers(h.deps).onEnded();
  assert.equal(h.played.length, 1);
});

test('a queue that starts with preview access can continue after access upgrades', async () => {
  const deps = {
    stopAfterEachTrackRef: ref(false), requestAuthoritativePlay: () => true,
    logDirectInternalCallViolation() {},
  };
  const service = { _deps: deps };
  attachQueueCommands(service);
  service.setQueueInternal = (tracks) => tracks;
  await service.playQueueInternal([{ ...queue[0], metadata: { access: { previewOnly: true } } }, queue[1]]);
  assert.equal(deps.stopAfterEachTrackRef.current, false);
  await service.playQueueInternal(queue, 0, { autoAdvance: false });
  assert.equal(deps.stopAfterEachTrackRef.current, true);
  await service.playQueueInternal(queue);
  assert.equal(deps.stopAfterEachTrackRef.current, false);
});

for (const source of ['home_single_card', 'home_feature_card', 'feature_card']) {
  test(`${source} advances its full queue then stops on the final selection with repeat off`, () => {
    const h = completionHarness();
    const completed = [];
    h.deps.queueRef.current = queue.map(track => ({ ...track, source }));
    h.state.currentTrack = h.deps.queueRef.current[0];
    h.deps.completeQueuePlayback = track => completed.push(track.id);
    const handlers = createPlaybackEventHandlers(h.deps);
    for (let i = 0; i < queue.length; i++) handlers.onEnded();
    assert.deepEqual(h.played, queue.map(track => track.id));
    assert.deepEqual(completed, [queue.at(-1).id]);
    assert.equal(h.state.currentTrack.id, queue.at(-1).id);
    assert.equal(h.deps.queueIndexRef.current, queue.length - 1);
    assert.equal(h.state.playbackState, 'idle');
  });
}

test('explicit repeat-all wraps the queue without completing transport', () => {
  const h = completionHarness();
  h.deps.repeatModeRef.current = 'all';
  h.deps.completeQueuePlayback = () => assert.fail('repeat-all must continue');
  const handlers = createPlaybackEventHandlers(h.deps);
  for (let i = 0; i < queue.length; i++) handlers.onEnded();
  assert.equal(h.played.length, queue.length + 1);
  assert.equal(h.state.currentTrack.id, queue[0].id);
});

for (const policy of ['stopAfterEachTrack', 'sleepAfterCurrentTrack']) {
  test(`${policy} ends through the authoritative completion contract`, () => {
    const h = completionHarness();
    if (policy === 'stopAfterEachTrack') h.deps.stopAfterEachTrackRef.current = true;
    else h.deps.sleepTimerRef.current.afterCurrentTrack = true;
    let completed = 0;
    h.deps.completeQueuePlayback = () => completed++;
    createPlaybackEventHandlers(h.deps).onEnded();
    assert.equal(completed, 1);
    assert.equal(h.played.length, 1);
    assert.equal(h.state.playbackState, 'idle');
  });
}
