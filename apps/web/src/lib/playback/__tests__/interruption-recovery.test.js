import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryFixture, flush, deferred } from './recovery-fixture.mjs';
import { playbackStateMachine as machine, PLAYBACK_ORCHESTRATION_EVENTS as E } from '../../../media/PlaybackStateMachine.js';

test('interrupted isPlaying=false resumes existing media and confirms advancement before success', async t=>{
  const h=recoveryFixture(t);
  const position=h.audio.currentTime,queue=h.deps.queueRef.current;
  const pending=h.commands.recoverAudioHard('output_change',{resumeAfter:true});
  await flush();
  assert.equal(h.audio.plays,1);assert.equal(h.state.isPlaying,false);
  h.advance();assert.equal(await pending,true);
  assert.equal(h.state.isPlaying,true);assert.equal(h.state.playbackState,'playing');
  assert.equal(h.audio.loads,0);assert.equal(h.audio.currentTime,position+0.3);
  assert.equal(h.deps.queueRef.current,queue);assert.equal(h.state.currentTrack,h.track);
});

for(const outcome of ['reject','resolve-paused','resolve-no-progress']) {
  test(`recovery never reports PLAYING when play ${outcome}`,async t=>{
    const h=recoveryFixture(t);
    h.audio.play=async()=>{h.audio.plays++;if(outcome==='reject')throw Object.assign(Error('interaction required'),{name:'NotAllowedError'});
      if(outcome==='resolve-no-progress')h.audio.paused=false;};
    machine.transition(E.STOP);machine.setLifecycleRecoveryGuard(()=>false);
    machine.setRecoverExecutor((...args)=>h.commands.recoverAudioHard(...args));
    t.after(()=>{machine.setRecoverExecutor(null);machine.transition(E.STOP);});
    const pending=machine.transition(E.RECOVERY_REQUESTED,{reason:'output_change',resumeAfter:true});
    await flush();t.mock.timers.tick(750);await flush();
    assert.equal(await pending,false);assert.notEqual(machine.getState(),'PLAYING');
    assert.equal(h.state.isPlaying,false);assert.equal(h.state.playbackState,'paused');
    assert.ok(h.state.error);assert.equal(h.audio.plays,1);
  });
}

test('a deliberate pause is never resumed by recovery',async t=>{
  const h=recoveryFixture(t);h.deps.userIntentPausedRef.current=true;
  assert.equal(await h.commands.recoverAudioHard('output_change',{resumeAfter:true}),false);
  assert.equal(h.audio.plays,0);assert.equal(h.audio.paused,true);
});

test('overlapping recovery requests share one lightweight media operation',async t=>{
  const h=recoveryFixture(t);
  const a=h.helpers.attemptLightweightPlaybackResume('route');
  const b=h.helpers.attemptLightweightPlaybackResume('context');
  assert.equal(a,b);await flush();assert.equal(h.audio.plays,1);
  h.advance();assert.equal(await a,true);assert.equal(await b,true);
});

for(const change of ['pause','track','same-track-new-generation']) {
  test(`pending recovery cannot overwrite a newer ${change}`,async t=>{
    const h=recoveryFixture(t),gate=deferred();
    h.context.state='suspended';h.context.resume=()=>gate.promise;
    const pending=h.commands.recoverAudioHard('output_change',{resumeAfter:true});await flush();
    if(change==='pause')h.deps.userIntentPausedRef.current=true;
    if(change==='track')h.state.currentTrack={...h.track,id:'new',metadata:{}};
    h.deps.commandRequestIdRef.current++;
    h.state.playbackState='newer-state';
    h.context.state='running';gate.resolve();await flush();
    assert.equal(await pending,false);assert.equal(h.state.playbackState,'newer-state');assert.equal(h.audio.plays,0);
  });
}

test('stale recovery result cannot overwrite newer orchestration',async t=>{
  const gate=deferred();machine.transition(E.STOP);machine.setLifecycleRecoveryGuard(()=>false);
  machine.setRecoverExecutor(()=>gate.promise);
  t.after(()=>{machine.setRecoverExecutor(null);machine.transition(E.STOP);});
  const pending=machine.transition(E.RECOVERY_REQUESTED,{resumeAfter:true});
  machine.transition(E.PLAY_PAUSE);gate.resolve(true);await pending;
  assert.equal(machine.getState(),'PAUSED');
});

for (const stalled of ['context','play']) {
  test(`an unsettled ${stalled} promise has a deadline and cannot strand recovery`,async t=>{
    const h=recoveryFixture(t),gate=deferred();
    if(stalled==='context'){h.context.state='suspended';h.context.resume=()=>gate.promise;}
    else h.audio.play=async()=>{h.audio.plays++;await gate.promise;h.audio.paused=false;};
    const pending=h.commands.recoverAudioHard('output_change',{resumeAfter:true});await flush();
    t.mock.timers.tick(2000);await flush();assert.equal(await pending,false);
    assert.equal(h.deps.isRecoveringRef.current,false);assert.equal(h.deps.recoveryVerificationRef.current,null);
    assert.equal(h.state.playbackState,'paused');assert.equal(h.state.isPlaying,false);
    gate.resolve();await flush();assert.equal(h.audio.paused,true,'late completion cannot start abandoned audio');
  });
}

test('a deliberate pause cancels a late play promise even after its command revision changes',async t=>{
  const h=recoveryFixture(t),gate=deferred();
  h.audio.play=async()=>{h.audio.plays++;await gate.promise;h.audio.paused=false;};
  const pending=h.commands.recoverAudioHard('output_change',{resumeAfter:true});await flush();
  h.deps.userIntentPausedRef.current=true;h.deps.commandRequestIdRef.current++;
  h.state.playbackState='paused-by-user';gate.resolve();await flush();
  assert.equal(await pending,false);assert.equal(h.audio.paused,true);assert.equal(h.state.playbackState,'paused-by-user');
});

test('native play during recovery does not publish PLAYING before progress is confirmed',async t=>{
  const h=recoveryFixture(t);t.mock.method(globalThis,'fetch',async()=>({ok:true}));
  const handlers=h.handlers();h.audio.addEventListener('play',handlers.onPlay);
  h.audio.play=async()=>{h.audio.plays++;h.audio.paused=false;h.audio.dispatchEvent(new Event('play'));};
  machine.transition(E.STOP);
  const pending=h.commands.recoverAudioHard('output_change',{resumeAfter:true});await flush();
  assert.equal(h.state.isPlaying,false);assert.notEqual(machine.getState(),'PLAYING');
  h.advance();assert.equal(await pending,true);assert.equal(h.state.isPlaying,true);assert.equal(machine.getState(),'PLAYING');
  t.after(()=>machine.transition(E.STOP));
});

test('pause/canplay interruption callbacks coalesce with route recovery',async t=>{
  const h=recoveryFixture(t);t.mock.method(globalThis,'fetch',async()=>({ok:true}));
  h.state.isPlaying=true;
  const handlers=h.handlers();handlers.onPause();
  t.mock.timers.tick(0);await flush();
  const pending=h.helpers.attemptLightweightPlaybackResume('device_change');
  h.audio.dispatchEvent(new Event('canplay'));await flush();
  assert.equal(h.audio.plays,1);h.advance();assert.equal(await pending,true);
});
