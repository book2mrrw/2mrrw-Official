import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryFixture, flush } from './recovery-fixture.mjs';
import { createOutputRouteRecovery } from '../output-route-recovery.js';
import { WebAudioEngine } from '../../audio/WebAudioEngine.js';

function route(t,h) {
  const controller=createOutputRouteRecovery({refs:h.deps,
    resume:reason=>h.helpers.attemptLightweightPlaybackResume(reason),patchState:h.deps.patchState});
  t.after(()=>controller.dispose());return controller;
}

test('Bluetooth device/context hint storms coalesce without element, source, queue or position reset',async t=>{
  const h=recoveryFixture(t),controller=route(t,h),src=h.audio.src,queue=h.deps.queueRef.current;
  const devices=new EventTarget();devices.addEventListener('devicechange',()=>controller.request());
  for(let i=0;i<20;i++)devices.dispatchEvent(new Event('devicechange'));
  t.mock.timers.tick(150);await flush();
  assert.equal(h.audio.plays,1);assert.equal(h.state.isPlaying,false);
  h.advance();await flush();
  assert.equal(h.state.isPlaying,true);assert.equal(h.audio.loads,0);assert.equal(h.audio.src,src);
  assert.equal(h.deps.audioRef.current,h.audio);assert.equal(h.deps.audioCtxRef.current,h.context);
  assert.equal(h.deps.queueRef.current,queue);assert.equal(h.audio.currentTime,64.3);
});

test('already playing route changes verify progress without a redundant play or seek',async t=>{
  const h=recoveryFixture(t);h.audio.paused=false;h.state.isPlaying=true;
  const controller=route(t,h);controller.request();t.mock.timers.tick(150);await flush();h.advance();await flush();
  assert.equal(h.audio.plays,0);assert.equal(h.audio.loads,0);assert.equal(h.audio.currentTime,64.3);
});

test('delayed connect/disconnect readiness succeeds within three attempts',async t=>{
  const h=recoveryFixture(t);let calls=0;
  h.context.state='suspended';h.context.resume=async()=>{calls++;if(calls<3)throw Error('route negotiating');h.context.state='running';};
  const controller=route(t,h);controller.request();t.mock.timers.tick(150);await flush();
  t.mock.timers.tick(250);await flush();t.mock.timers.tick(750);await flush();
  h.advance();await flush();assert.equal(h.state.isPlaying,true);assert.equal(h.audio.loads,0);
});

test('route failure reaches a bounded terminal state; repeated hints during cooldown do not loop',async t=>{
  const h=recoveryFixture(t);h.audio.play=async()=>{h.audio.plays++;throw Object.assign(Error('gesture required'),{name:'NotAllowedError'});};
  const controller=route(t,h);controller.request();
  for(const ms of [150,250,750]){t.mock.timers.tick(ms);await flush();}
  assert.equal(h.audio.plays,3);assert.equal(h.state.isPlaying,false);assert.equal(h.state.playbackState,'paused');
  for(let i=0;i<20;i++)controller.request();t.mock.timers.tick(1000);await flush();assert.equal(h.audio.plays,3);
});

for(const scenario of ['pause','new-track','loading','ended','dispose']) {
  test(`queued device recovery respects ${scenario}`,async t=>{
    const h=recoveryFixture(t),controller=route(t,h);
    if(scenario==='loading')h.state.playbackNetworkState='loading_stream';
    if(scenario==='ended')h.audio.ended=true;
    controller.request();
    if(scenario==='pause')h.deps.userIntentPausedRef.current=true;
    if(scenario==='new-track')h.deps.playRequestIdRef.current++;
    if(scenario==='dispose')controller.dispose();
    t.mock.timers.tick(150);await flush();assert.equal(h.audio.plays,0);assert.equal(h.audio.loads,0);
  });
}

test('a supported sinkchange reaches the same reconciliation callback without context recreation',t=>{
  const context=Object.assign(new EventTarget(),{state:'running'}),engine=new WebAudioEngine();
  engine.ctx=context;let hints=0;engine.registerContextRunningCallback(()=>hints++);engine._attachStateChange();
  context.dispatchEvent(new Event('sinkchange'));assert.equal(hints,1);assert.equal(engine.ctx,context);
});
