import assert from 'node:assert/strict';
import { test, beforeEach, afterEach, mock } from 'node:test';

let prepared;
let preparations = 0;
mock.module('../crossfade/deck.js', { namedExports: { prepareDeck: async () => { preparations++; return prepared; } } });
// React presentation bridge is outside this transport integration harness.
mock.module('../../../media/mediaEngineBridge.js', { namedExports: { notifyMediaEngineBridge() {} } });
mock.module('../../media/preload.js', { namedExports: { preloadCoverImage() {} } });
const { configureCrossfade } = await import('../crossfade/browser-runtime.js');
const { setCrossfadeEnabled } = await import('../crossfade/preference.js');
const { getAudioEngineRuntime } = await import('../audio-engine-runtime.js');
const { getWebAudioEngine } = await import('../../audio/WebAudioEngine.js');
const { attachStreamCommands } = await import('../PlaybackStreamCommands.js');
const { buildWiredCore } = await import('../../playback-core/production/wireProductionCore.js');

const ref = (current) => ({ current });
class Audio extends EventTarget {
  constructor(time = 0) {
    super(); Object.assign(this, { currentTime: time, duration: 100, paused: false,
      ended: false, readyState: 4, playbackRate: 1, muted: false, src: '/unchanged.mp3', loads: 0,
      buffered: { length: 1, start: () => 0, end: () => 100 } });
  }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.loads++; }
}
function gain() {
  return { gain: { value: 1, curves: [],
    cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    setValueCurveAtTime(curve, now, duration) { this.curves.push({ curve, now, duration }); },
  } };
}
const tracks = ['a', 'b', 'c'].map((id) => ({ id, slug: id, src: `/${id}.mp3`, source: 'playlist', metadata: { access: { canStream: true } } }));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let runtime, engine, r, requests, lifecycle, outgoing, incoming, services, allowed;
beforeEach(() => {
  runtime = getAudioEngineRuntime(); runtime.crossfade?.dispose(); setCrossfadeEnabled(false);
  engine = getWebAudioEngine(); engine._handlers.clear();
  outgoing = new Audio(90); incoming = new Audio(); incoming.muted = true;
  engine.ctx = { currentTime: 10, state: 'running' };
  engine.mainGain = gain(); engine._standbyGain = gain(); engine._standbyGain.gain.value = 0;
  engine._boundElement = outgoing; engine._standbyElement = incoming;
  engine.source = {}; engine._standbySource = {};
  const hls = { detachCount: 0, detach() { this.detachCount++; } };
  prepared = { element: incoming, hls: null, ready: () => true, prime: async () => true,
    release() { incoming.pause(); }, transfer() {} };
  preparations = 0; requests = []; lifecycle = 0; allowed = true;
  r = Object.fromEntries([
    ['stateRef', { currentTrack: tracks[0], source: 'playlist', isPlaying: true }],
    ['audioRef', outgoing], ['queueRef', tracks], ['queueIndexRef', 0],
    ['playRequestIdRef', 1], ['entitlementAccountStateRef', {}],
    ['shuffleRef', false], ['repeatModeRef', 'off'], ['shuffledOrderRef', null], ['shufflePositionRef', 0],
    ['userPausedRef', false], ['userIntentPausedRef', false], ['csModeRef', false],
    ['stopAfterEachTrackRef', false], ['sleepTimerRef', {}], ['recentStallTimeRef', 0],
    ['hlsEngineRef', hls], ['activeStreamAbortRef', null], ['sourceRef', engine.source],
    ['mainGainRef', engine.mainGain], ['mediaElementSourceElementRef', outgoing],
    ['streamMetaRef', null], ['lastPlayedSlugRef', 'a'], ['listeningUserIdRef', null],
    ['pendingSeekRef', null], ['spuriousEndedGuardRef', 0],
  ].map(([key, value]) => [key, ref(value)]));
  runtime.rebindPlaybackElement = () => ({ onPlay: () => lifecycle++ });
  services = { patchState: (patch) => Object.assign(r.stateRef.current, patch),
    syncProgressTime() {}, recordLocalListening() {}, finalizeStreamSession() {} };
  configureCrossfade(r, services, {
    requestAuthoritativePlay(track, options, policy) { requests.push({ track, options, policy }); return true; },
  });
});
afterEach(() => {
  runtime.crossfade.dispose(); setCrossfadeEnabled(false); engine._detachAudioElementListeners();
});

async function requestOverlap() {
  setCrossfadeEnabled(true); engine._emit('timeupdate'); await flush();
  outgoing.currentTime = 96; engine._emit('timeupdate'); await flush();
  assert.equal(requests.length, 1);
  const request = requests[0];
  return { ...request, options: { ...request.options, effectAuthorityMode: 'CORE',
    effectAuthority: { revision: 2 }, canApplyEffect: () => allowed } };
}

test('off has no engine subscriptions or preparation and leaves normal commands untouched', async () => {
  engine._emit('timeupdate'); await flush();
  runtime.crossfade.beforeCommand({ type: 'PLAY_TRACK', payload: {} });
  assert.equal(preparations, 0); assert.equal(requests.length, 0);
  assert.equal(r.audioRef.current, outgoing); assert.equal(outgoing.loads, 0); assert.equal(outgoing.paused, false);
});
test('real stream-command entry adopts the ready deck without loading or pausing either track', async () => {
  const request = await requestOverlap();
  const service = { _deps: {} }; attachStreamCommands(service);
  assert.equal(await service.playTrackInternal(request.track, request.options), true);
  assert.equal(r.audioRef.current, incoming); assert.equal(runtime.audioElement, incoming);
  assert.equal(engine._boundElement, incoming); assert.equal(r.queueIndexRef.current, 1);
  assert.equal(r.stateRef.current.currentTrack.id, 'b'); assert.equal(lifecycle, 1);
  assert.equal(outgoing.loads + incoming.loads, 0); assert.equal(outgoing.paused, false);
  assert.equal(incoming.muted, false); assert.equal(outgoing.playbackRate, 1); assert.equal(incoming.playbackRate, 1);
  assert.equal(engine.mainGain.gain.curves[0].duration, 4);
  assert.equal(request.policy.queueEntries, tracks); assert.equal(request.policy.queueIndex, 1);
});
test('authority denial cannot unmute, switch identities or consume the queue', async () => {
  const request = await requestOverlap(); allowed = false;
  assert.equal(runtime.crossfade.adopt(request.track, request.options), false);
  assert.equal(incoming.muted, true); assert.equal(r.audioRef.current, outgoing);
  assert.equal(r.queueIndexRef.current, 0); assert.equal(outgoing.paused, false);
});
test('turning off during an overlap lets the existing fade finish; tail completion never advances again', async () => {
  const request = await requestOverlap(); runtime.crossfade.adopt(request.track, request.options);
  setCrossfadeEnabled(false);
  assert.equal(outgoing.paused, false); assert.equal(incoming.paused, false);
  outgoing.ended = true; outgoing.dispatchEvent(new Event('ended'));
  assert.equal(outgoing.paused, true); assert.equal(incoming.paused, false);
  assert.equal(r.queueIndexRef.current, 1); assert.equal(requests.length, 1);
});
test('outgoing session finalizes only when its tail ends and only once', async () => {
  const meta = { slug: 'a', sessionId: 'outgoing' };
  r.streamMetaRef.current = meta;
  const finalized = [];
  services.finalizeStreamSession = (...args) => finalized.push(args);
  const request = await requestOverlap(); runtime.crossfade.adopt(request.track, request.options);
  assert.equal(finalized.length, 0);
  outgoing.currentTime = 100; outgoing.ended = true;
  outgoing.dispatchEvent(new Event('ended'));
  runtime.crossfade.beforeCommand({ type: 'PAUSE', payload: {} });
  assert.deepEqual(finalized, [[meta, { completed: true, durationSeconds: 100 }]]);
});
test('late outgoing session finalization preserves a successor session at the shared helper', async () => {
  const { createPlaybackHelpers } = await import('../PlaybackHelperService.js');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const outgoingMeta = { slug: 'a', sessionId: 'outgoing' };
    const successorMeta = { slug: 'b', sessionId: 'successor' };
    const streamMetaRef = ref(successorMeta);
    const helpers = createPlaybackHelpers({ streamMetaRef });
    helpers.finalizeStreamSession(outgoingMeta, { completed: true, durationSeconds: 100 });
    assert.equal(streamMetaRef.current, successorMeta);
    helpers.finalizeStreamSession(successorMeta);
    assert.equal(streamMetaRef.current, null);
  } finally { globalThis.fetch = previousFetch; }
});
for (const type of ['PAUSE', 'SEEK', 'NEXT_TRACK', 'STOP', 'PLAY_TRACK', 'RECOVER']) {
  test(`${type} releases the outgoing tail before ordinary command handling`, async () => {
    const request = await requestOverlap(); runtime.crossfade.adopt(request.track, request.options);
    runtime.crossfade.beforeCommand({ type, payload: {} });
    assert.equal(outgoing.paused, true); assert.equal(r.audioRef.current, incoming);
    assert.equal(incoming.loads, 0); assert.equal(requests.length, 1);
  });
}
test('repeated configuration preserves runtime and listeners rather than mounting another transport', async () => {
  setCrossfadeEnabled(true);
  const owner = runtime.crossfade;
  const count = engine._handlers.get('timeupdate').size;
  configureCrossfade(r, services, { requestAuthoritativePlay() {} });
  assert.equal(runtime.crossfade, owner); assert.equal(engine._handlers.get('timeupdate').size, count);
});

test('real Core, dispatcher and stream handoff converge without reloading; emergency pause stops both decks', async () => {
  Object.assign(runtime.refs, r);
  runtime.refs.stateGetterRef.current = () => r.stateRef.current;
  runtime.refs.commandQueueRef.current = Promise.resolve();
  runtime.refs.activeCommandRef.current = null;
  runtime.refs.initWebAudioRef.current = null;
  let starts = 0;
  const service = { _deps: {} }; attachStreamCommands(service);
  runtime.refs.commandHandlersRef.current = {
    playTrack(track, options) {
      starts++;
      if (!options.crossfadeToken && track.id === 'a') return true; // already playing fixture
      return service.playTrackInternal(track, options);
    },
    pause() { r.audioRef.current.pause(); r.stateRef.current.isPlaying = false; },
    resume() { r.audioRef.current.paused = false; r.stateRef.current.isPlaying = true; return true; },
    seek(time) { r.audioRef.current.currentTime = time; },
  };
  const core = buildWiredCore({ loggerEnabled: false });
  try {
    core.port.play({ trackId: 'a', queueEntries: tracks, queueIndex: 0 });
    await runtime.refs.commandQueueRef.current;
    await core._executionEngine.converge('seed');
    configureCrossfade(r, services, {
      requestAuthoritativePlay(track, options, policy) {
        if (core.desiredState.desiredTransport !== 'PLAYING' ||
            core.desiredState.requestedMediaIdentity !== policy.expectedCurrentMediaIdentity) return false;
        core.port.play({ trackId: track.id, options, queueEntries: policy.queueEntries, queueIndex: policy.queueIndex, source: 'autoplay' });
        return true;
      },
    });
    setCrossfadeEnabled(true); outgoing.currentTime = 96;
    engine._emit('timeupdate'); await flush();
    await runtime.refs.commandQueueRef.current;
    await core._executionEngine.converge('handoff');
    assert.equal(core.desiredState.requestedMediaIdentity, 'b');
    assert.equal(r.audioRef.current, incoming);
    assert.equal(starts, 2); // initial fixture + one accepted handoff, no corrective reload
    core.port.pause(); await flush(); await core._executionEngine.converge('pause');
    assert.equal(outgoing.paused, true); assert.equal(incoming.paused, true);
    assert.equal(core.desiredState.desiredTransport, 'PAUSED');
    assert.equal(starts, 2); assert.equal(outgoing.loads + incoming.loads, 0);
  } finally { core.destroy(); }
});
