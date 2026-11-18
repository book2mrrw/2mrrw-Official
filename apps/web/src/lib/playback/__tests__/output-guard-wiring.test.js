import test from 'node:test';
import assert from 'node:assert/strict';
import { audioParamHost } from './audio-param-host.mjs';
import { WebAudioEngine } from '../../audio/WebAudioEngine.js';
import { loadOutputGuard } from '../../audio/output-guard.js';

function setup(t,{worklet=true,paused=true}={}) {
  const h=audioParamHost(t);
  if(worklet)h.ctx.audioWorklet={addModule:async()=>{}};
  globalThis.AudioWorkletNode=function AudioWorkletNode(){return h.node('guard');};
  t.after(()=>{delete globalThis.AudioWorkletNode;});
  const engine=new WebAudioEngine();
  const audio=Object.assign(new EventTarget(),{paused,ended:false,volume:1});
  engine.ctx=h.ctx;engine.source=h.node('source');engine._boundElement=audio;
  const told=[];engine.registerLimiterChangeCallback(limiter=>told.push(limiter));
  engine.buildGraph();
  return {...h,engine,audio,told,settle:async()=>{await loadOutputGuard(h.ctx);await null;}};
}

test('the stand-in compressor gives way to the output guard while the element is silent',async t=>{
  const {engine,ctx,told,settle}=setup(t);
  const standIn=engine.limiter,route=engine._effectRouting;
  assert.equal(standIn.kind,'compressor');
  await settle();
  const guard=engine.limiter;
  assert.equal(guard.kind,'guard');
  assert.deepEqual(told,[guard]);
  assert.equal(route.limiter,guard);
  for(const fader of [route.dry,route.wet]){assert.ok(fader.connections.has(guard));assert.ok(!fader.connections.has(standIn));}
  assert.ok(guard.connections.has(ctx.destination));
  assert.equal(standIn.connections.size,0);
});

test('while music plays the swap waits for the next silence, never switching under it',async t=>{
  const {engine,audio,settle}=setup(t,{paused:false});
  await settle();
  assert.equal(engine.limiter.kind,'compressor');
  audio.dispatchEvent(new Event('waiting'));
  assert.equal(engine.limiter.kind,'guard');
});

test('a graph rebuilt on the same context starts with the guard',async t=>{
  const {engine,settle}=setup(t);
  await settle();
  engine.buildGraph();
  assert.equal(engine.limiter.kind,'guard');
  assert.equal(engine._effectRouting.limiter,engine.limiter);
});

test('without AudioWorklet the compressor stays in place',async t=>{
  const {engine,settle}=setup(t,{worklet:false});
  await settle();
  assert.equal(engine.limiter.kind,'compressor');
});

test('a context replaced before the worklet loads never receives a guard',async t=>{
  const {engine,settle,audio}=setup(t,{paused:false});
  const standIn=engine.limiter;
  engine.ctx={state:'running'};
  await settle();
  audio.dispatchEvent(new Event('pause'));
  assert.equal(engine.limiter,standIn);
});
