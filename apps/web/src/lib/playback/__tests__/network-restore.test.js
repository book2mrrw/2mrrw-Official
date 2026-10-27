import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryFixture, flush, deferred } from './recovery-fixture.mjs';

function setup(t) {
  const h = recoveryFixture(t);
  h.audio.paused = false;
  h.audio.src = h.audio.currentSrc = 'blob:active-hls';
  // Model the browser's source reset and readiness events at the host boundary.
  let source = h.audio.src;
  Object.defineProperty(h.audio, 'src', { configurable: true,
    get: () => source,
    set(value) { if (value !== source) { h.audio.error = null; h.audio.readyState = 0; } source = value; },
  });
  const load = h.audio.load;
  h.audio.load = function () {
    load.call(this);
    this.readyState = 4;
    queueMicrotask(() => this.dispatchEvent(new Event('canplay')));
  };
  h.state.isPlaying = true;
  return { ...h, handlers: h.handlers() };
}

for (const source of ['blob:active-hls', '/recording.mp3']) {
  test(`online preserves healthy ${source} playback and queue`, async t => {
    const h = setup(t), queue = h.deps.queueRef.current;
    const hls = {isLoaded:true,detach(){throw Error('healthy HLS must remain attached');}};
    h.deps.hlsEngineRef.current = hls;
    h.audio.src = h.audio.currentSrc = source;
    h.audio.readyState = 4;
    let resolves = 0, pauses = 0;
    t.mock.method(globalThis, 'fetch', async () => { resolves++; throw Error('unexpected resolve'); });
    t.mock.method(h.audio, 'pause', () => { pauses++; });
    await h.handlers.onOnline();
    assert.equal(resolves, 0);
    assert.equal(pauses, 0);
    assert.equal(h.audio.loads, 0);
    assert.equal(h.audio.plays, 0);
    assert.equal(h.audio.src, source);
    assert.equal(h.audio.currentTime, 64);
    assert.equal(h.deps.queueRef.current, queue);
    assert.equal(h.deps.queueIndexRef.current, 2);
    assert.equal(h.deps.hlsEngineRef.current, hls);
  });
}

test('online leaves an attached HLS underrun with the existing stall owner', async t => {
  const h = setup(t);
  h.audio.readyState = 2;
  let stalls = 0;
  h.deps.startStallRecovery = () => { stalls++; };
  h.handlers = (await import('../PlaybackEventHandlers.js')).createPlaybackEventHandlers(h.deps);
  await h.handlers.onOnline();
  assert.equal(stalls, 1);
  assert.equal(h.audio.src, 'blob:active-hls');
  assert.equal(h.audio.loads, 0);
  assert.equal(h.audio.plays, 0);
});

test('online resumes an interrupted element without replacing HLS or the queue', async t => {
  const h = setup(t), queue = h.deps.queueRef.current;
  h.audio.paused = true;
  h.state.isPlaying = false;
  h.state.osInterrupted = true;
  const pending = h.handlers.onOnline();
  await flush();
  h.advance();
  assert.equal(await pending, true);
  assert.equal(h.audio.loads, 0);
  assert.equal(h.audio.src, 'blob:active-hls');
  assert.equal(h.deps.queueRef.current, queue);
  assert.equal(h.deps.queueIndexRef.current, 2);
});

test('online coalesces actual source-error recovery and preserves the recording and queue', async t => {
  const h = setup(t), queue = h.deps.queueRef.current;
  h.audio.error = { code: 2 };
  let detaches = 0;
  h.deps.hlsEngineRef.current = {detach(){detaches++;}};
  let resolves = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    resolves++;
    assert.equal(new URL(url, 'https://test.invalid').searchParams.get('trackSlug'), 'song-three');
    assert.equal(opts.credentials, 'include');
    return { ok: true, status: 200, headers: new Headers({'content-type':'application/json'}),
      json: async () => ({ url: h.track.src }) };
  });
  const pending = h.handlers.onOnline();
  h.handlers.onOnline();
  await flush();
  h.advance();
  assert.equal(await pending, true);
  assert.equal(resolves, 1);
  assert.equal(h.state.currentTrack.id, h.track.id);
  assert.equal(h.deps.queueRef.current, queue);
  assert.equal(h.deps.queueIndexRef.current, 2);
  assert.equal(detaches, 1);
  assert.equal(h.deps.hlsEngineRef.current, null);
});

test('online error recovery respects fresh server denial and does not retry denied media', async t => {
  const h = setup(t);
  h.audio.error = {code:2};
  let resolves = 0;
  t.mock.method(globalThis, 'fetch', async () => {resolves++;return {ok:false,status:403};});
  assert.equal(await h.handlers.onOnline(), false);
  assert.equal(h.state.accessDenied, true);
  assert.equal(h.state.streamRetryable, false);
  await h.handlers.onOnline();
  assert.equal(resolves, 1);
  assert.equal(h.audio.plays, 0);
  assert.equal(h.deps.queueIndexRef.current, 2);
});

test('offline errors return through the bounded online recovery owner without a forced play listener', async t => {
  const h = setup(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const host = new EventTarget();let subscriptions=0;
  const add = host.addEventListener.bind(host);
  host.addEventListener = (...args) => { if(args[0]==='online')subscriptions++;add(...args); };
  Object.defineProperty(globalThis, 'window', {configurable:true,value:host});
  t.after(() => {if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
  navigator.onLine = false;
  h.audio.error = {code:2};
  let forced=0,resolves=0;
  h.deps.playTrackRef.current = () => {forced++;};
  t.mock.method(globalThis,'fetch',async()=>{resolves++;return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({url:h.track.src})};});
  await h.handlers.onError();
  assert.equal(subscriptions,0);assert.equal(resolves,0);
  assert.equal(h.state.error,'RECONNECTING');
  navigator.onLine = true;
  const pending=h.handlers.onOnline();h.handlers.onOnline();
  await flush();h.advance();
  assert.equal(await pending,true);
  assert.equal(forced,0);assert.equal(resolves,1);
  assert.equal(h.deps.queueIndexRef.current,2);
});

test('online restores a suspended context without replacing an attached HLS source', async t => {
  const h = setup(t);
  h.context.state = 'suspended';
  const pending = h.handlers.onOnline();
  await flush();
  h.advance();
  assert.equal(await pending, true);
  assert.equal(h.context.resumes, 1);
  assert.equal(h.audio.loads, 0);
  assert.equal(h.audio.src, 'blob:active-hls');
});

for (const condition of ['userPaused', 'userIntentPaused', 'ended', 'accessDenied', 'loading', 'noIntent']) {
  test(`online does not recover ${condition}`, async t => {
    const h = setup(t);
    h.audio.error = { code: 2 };
    if (condition === 'userPaused') h.deps.userPausedRef.current = true;
    if (condition === 'userIntentPaused') h.deps.userIntentPausedRef.current = true;
    if (condition === 'ended') h.audio.ended = true;
    if (condition === 'accessDenied') h.state.accessDenied = true;
    if (condition === 'loading') h.state.playbackState = 'loading';
    if (condition === 'noIntent') {
      h.state.isPlaying = false;
      h.deps.playbackIntentBeforeHideRef.current = false;
    }
    let resolves = 0;
    t.mock.method(globalThis, 'fetch', async () => { resolves++; throw Error('unexpected resolve'); });
    await h.handlers.onOnline();
    assert.equal(resolves, 0);
    assert.equal(h.audio.plays, 0);
  });
}

for (const change of ['pause', 'track', 'request']) {
  test(`online recovery cannot apply a late response after ${change}`, async t => {
    const h = setup(t), gate = deferred();
    h.audio.error = { code: 2 };
    t.mock.method(globalThis, 'fetch', () => gate.promise);
    const pending = h.handlers.onOnline();
    await flush();
    if (change === 'pause') h.deps.userIntentPausedRef.current = true;
    if (change === 'track') h.state.currentTrack = { ...h.track, id: 'album:four', metadata: { ...h.track.metadata, trackSlug: 'four', trackIndex:3 } };
    if (change === 'request') h.deps.commandRequestIdRef.current++;
    gate.resolve({ ok: true, status: 200, headers: new Headers({'content-type':'application/json'}), json: async () => ({url:h.track.src}) });
    assert.equal(await pending, false);
    assert.equal(h.audio.loads, 0);
    assert.equal(h.audio.plays, 0);
    assert.equal(h.audio.src, 'blob:active-hls');
  });
}

test('offline/online events do not replenish an exhausted media-error retry budget',async t=>{
  const h=setup(t);h.audio.error={code:2};h.deps.streamErrorRetriedRef.current=3;
  navigator.onLine=false;await h.handlers.onError();navigator.onLine=true;
  let resolves=0;t.mock.method(globalThis,'fetch',async()=>{resolves++;throw Error('budget exhausted');});
  assert.equal(await h.handlers.onOnline(),false);
  assert.equal(resolves,0);assert.equal(h.deps.streamErrorRetriedRef.current,3);
  assert.equal(h.deps.queueIndexRef.current,2);
});
