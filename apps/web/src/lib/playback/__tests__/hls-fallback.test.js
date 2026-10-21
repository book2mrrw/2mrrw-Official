import test from 'node:test';
import assert from 'node:assert/strict';
import { createHlsFallback } from '../hls-fallback.js';
import { recoveryFixture, flush } from './recovery-fixture.mjs';
import { recoveryCoordinator } from '../recovery-coordinator.js';

function setup(t) {
  const h = recoveryFixture(t);
  t.after(() => recoveryCoordinator.resetForNewTrack());
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({url:h.track.src})}));
  h.audio.src = 'blob:old-hls';
  h.audio.currentSrc = h.track.src;
  const fallback = createHlsFallback({ refs: h.deps, requestId: 1, src: h.track.src,
    patchState: h.deps.patchState, resume: h.deps.attemptLightweightPlaybackResume });
  return { ...h, fallback };
}

test('post-startup HLS fallback preserves recording and saved position, coalesces errors and confirms advancement', async t => {
  const h = setup(t);
  const pending = h.fallback({ position: 83 });
  assert.equal(h.fallback({ position: 0 }), pending);
  await flush();
  assert.equal(h.audio.currentTime, 83);
  h.advance();
  assert.equal(await pending, true);
  assert.equal(h.audio.plays, 1);
  assert.equal(h.state.currentTrack.id, 'album:song-three');
  assert.equal(h.deps.queueIndexRef.current, 2);
});

test('a deliberate pause during fallback never resumes audio', async t => {
  const h = setup(t);
  const pending = h.fallback({ position: 83 });
  h.deps.userIntentPausedRef.current = true;
  assert.equal(await pending, true);
  assert.equal(h.audio.plays, 0);
  assert.equal(h.state.playbackState, 'paused');
});

test('an old HLS callback cannot replace a newer track or play request', async t => {
  const h = setup(t); h.deps.playRequestIdRef.current++;
  assert.equal(await h.fallback({ position: 83 }), false);
  assert.equal(h.audio.src, 'blob:old-hls');
  assert.equal(h.audio.plays, 0);
});

test('a new selection during source readiness blocks stale seek and resume', async t => {
  const h = setup(t); h.audio.readyState = 0; h.audio.networkState = 2;
  const pending = h.fallback({ position: 83 });
  await flush();
  h.deps.playRequestIdRef.current++;
  h.audio.currentTime = 7;
  h.audio.readyState = 4; h.audio.dispatchEvent(new Event('canplay'));
  assert.equal(await pending, false);
  assert.equal(h.audio.currentTime, 7);
  assert.equal(h.audio.plays, 0);
});

test('failed fallback becomes an explicit retryable error without skipping a song', async t => {
  const h = setup(t); h.audio.readyState = 0; h.audio.networkState = 2;
  const pending = h.fallback({ position: 83 });
  await flush();
  h.audio.dispatchEvent(new Event('error'));
  assert.equal(await pending, false);
  assert.equal(h.state.streamRetryable, true);
  assert.equal(h.state.playbackNetworkState, 'error_stream');
  assert.equal(h.deps.queueIndexRef.current, 2);
});

test('fresh authorization denial during fallback is terminal and never resumes cached audio', async t => {
  const h = setup(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: false, status: 403 }; });
  assert.equal(await h.fallback({ position: 83 }), false);
  assert.equal(calls, 1);
  assert.equal(h.state.accessDenied, true);
  assert.equal(h.state.streamRetryable, false);
  assert.equal(h.audio.plays, 0);
});
