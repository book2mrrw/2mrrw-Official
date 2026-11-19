import assert from 'node:assert/strict';
import test from 'node:test';
import { flush, recoveryFixture } from './recovery-fixture.mjs';

// In the app the native player owns the lock screen, Control Center, headphones
// and calls; a play or pause it made by itself is the listener's decision.
function nativeFixture(t, { byNative }) {
  const h = recoveryFixture(t);
  h.audio.isNativeAudio = true;
  h.audio.changedByNative = byNative;
  h.pauses = 0;
  const pause = h.audio.pause.bind(h.audio);
  h.audio.pause = () => { h.pauses += 1; pause(); };
  return h;
}

for (const byNative of [true, false]) {
  test(`a pause ${byNative ? 'from the lock screen is the listener\'s: never resumed' : 'the engine cannot account for is still resumed as an interruption'}`, async (t) => {
    const h = nativeFixture(t, { byNative });
    Object.assign(h.state, { isPlaying: true, playbackState: 'playing' });
    h.audio.paused = true;
    h.handlers().onPause();
    t.mock.timers.tick(50);
    await flush();
    assert.equal(h.audio.plays, byNative ? 0 : 1);
    assert.equal(h.deps.userIntentPausedRef.current, byNative);
    if (byNative) assert.equal(h.state.isPlaying, false);
  });

  test(`a play ${byNative ? 'from the lock screen after an in-app pause is the listener\'s: not re-paused' : 'arriving late after an in-app pause is undone'}`, async (t) => {
    const h = nativeFixture(t, { byNative });
    h.deps.userIntentPausedRef.current = true;
    h.audio.paused = false;
    h.handlers().onPlay();
    assert.equal(h.pauses, byNative ? 0 : 1);
    assert.equal(h.deps.userIntentPausedRef.current, !byNative);
    if (byNative) assert.equal(h.state.isPlaying, true);
  });
}
