import test from 'node:test';
import assert from 'node:assert/strict';
import { audioParamHost } from './audio-param-host.mjs';
import { WebAudioEngine, getWebAudioEngine } from '../../audio/WebAudioEngine.js';
import { interactiveMediaState as ims } from '../../../media/InteractiveMediaState.js';
import { playbackStateMachine as machine } from '../../../media/PlaybackStateMachine.js';
import '../../../media/effects/ChopEngine.js';
import '../../../media/effects/FilterEngine.js';

function setup(t,singleton=false) {
  const h=audioParamHost(t),engine=singleton?getWebAudioEngine():new WebAudioEngine();
  const saved={...engine};
  const previous=machine.getContext();
  engine.ctx=h.ctx;engine.source=h.node('source');engine._boundElement={volume:1};
  engine._chainExtensionNodes=[];engine._effectRouting=null;engine._effectChange=null;
  engine.buildGraph();
  t.after(()=>{
    if(singleton){ims.unlockSlow();ims.deactivateFilter();t.mock.timers.tick(1000);machine.updateContext(previous);}
    clearTimeout(engine._effectChange?.timer);
    Object.assign(engine,saved);
  });
  return {...h,engine};
}
function assertComplement(route,start,end) {
  for(let time=start;time<=end;time+=.0005) {
    const dry=route.dry.gain.valueAt(time),wet=route.wet.gain.valueAt(time);
    assert.ok(dry>=-1e-9&&wet>=-1e-9);
    assert.ok(Math.abs(dry+wet-1)<1e-9,'dry + wet must stay unity');
  }
}
test('effect activation, replacement and removal keep primary routing and complementary gains',t=>{
  const {engine,node,disconnects}=setup(t);
  const source=engine.source,main=engine.mainGain,user=engine.userGain,limiter=engine.limiter;
  const route=engine._effectRouting;
  const first=node(),second=node();
  const before=disconnects.length;
  engine.setChainExtension([first]);
  assertComplement(route,10,10.01);t.mock.timers.tick(10);
  engine.setChainExtension([second]);
  assert.ok(first.connections.has(route.wet));
  assert.ok(!second.connections.has(route.wet));
  assertComplement(route,10.01,10.02);
  t.mock.timers.tick(10);
  assert.equal(first.connections.size,0);assert.ok(second.connections.has(route.wet));
  assertComplement(route,10.02,10.03);t.mock.timers.tick(10);
  engine.setChainExtension([]);assertComplement(route,10.03,10.04);t.mock.timers.tick(10);
  assert.equal(second.connections.size,0);
  assert.equal(engine.source,source);assert.equal(engine.mainGain,main);assert.equal(engine.userGain,user);
  assert.equal(engine.limiter,limiter);assert.ok(source.connections.has(main));
  assert.ok(!disconnects.slice(before).some(x=>[source,main,user,limiter].includes(x.node)));
  assert.equal(engine._effectChange,null);
});
test('a superseded handoff only installs the latest effect',t=>{
  const {engine,node}=setup(t),a=node(),b=node(),c=node();
  const route=engine._effectRouting;
  engine.setChainExtension([a]);t.mock.timers.tick(10);
  engine.setChainExtension([b]);t.mock.timers.tick(4);engine.setChainExtension([c]);
  assertComplement(route,10.014,10.024);t.mock.timers.tick(10);
  assert.deepEqual(route.nodes,[c]);assert.equal(b.connections.size,0);
  assert.equal(a.connections.size,0);
});
test('reselecting a fading owner cancels removal without rewiring it',t=>{
  const {engine,node,disconnects}=setup(t),a=node(),route=engine._effectRouting;
  engine.setChainExtension([a]);t.mock.timers.tick(10);
  const before=disconnects.length;
  engine.setChainExtension([]);t.mock.timers.tick(4);engine.setChainExtension([a]);
  assertComplement(route,10.014,10.024);t.mock.timers.tick(20);
  assert.deepEqual(route.nodes,[a]);
  assert.equal(disconnects.length,before);
});
test('unchanged filter updates do not allocate faders or repeat handoffs',t=>{
  const {engine,node,nodes}=setup(t),a=node();
  engine.setChainExtension([a]);t.mock.timers.tick(10);
  const count=nodes.length,route=engine._effectRouting;
  for(let i=0;i<20;i++)engine.setChainExtension([a]);
  assert.equal(nodes.length,count);assert.equal(engine._effectChange,null);
  assert.equal(engine._effectRouting,route);
});
test('a graph replacement cancels a stale effect timer',t=>{
  const {engine,node}=setup(t),a=node(),b=node();
  engine.setChainExtension([a]);t.mock.timers.tick(10);engine.setChainExtension([b]);
  engine.buildGraph();const route=engine._effectRouting;
  t.mock.timers.tick(100);assert.equal(engine._effectRouting,route);
  assert.equal(engine._effectChange,null);assert.deepEqual(route.nodes,[b]);
});
test('suspended output settles a pending effect handoff without a lingering timer',t=>{
  const {engine,node}=setup(t),a=node();
  engine.setChainExtension([a]);t.mock.timers.tick(10);engine.setChainExtension([]);
  engine.ctx.state='suspended';t.mock.timers.tick(10);
  assert.equal(engine._effectChange,null);assert.deepEqual(engine._effectRouting.nodes,[]);
  assert.equal(a.connections.size,0);
  assert.equal(engine._effectRouting.dry.gain.value,1);
});
for(const nx of [0,.5,1]) {
  test('actual Chop gates are continuous at slow/middle/fast period '+nx,t=>{
    const {engine}=setup(t,true);
    machine.updateContext({hasStarted:true,currentTrackId:'test:chop',currentTrack:{id:'test:chop'}});
    ims.beginSlowMomentary('test');ims.lockSlow();ims.fireChop(nx,.5);
    const gain=engine._chainExtensionNodes[0].gain;
    assert.equal(gain.events.filter(e=>e.kind==='ramp').length,8);
    for(const e of gain.events)assert.ok(Math.abs(gain.valueAt(e.time-1e-8)-gain.valueAt(e.time+1e-8))<1e-5);
    const sample=(time)=>.6*Math.sin(2*Math.PI*997*time+.41)*gain.valueAt(time);
    let maxJump=0;
    for(let i=0;i<44100*.9;i++){const time=10+i/44100;maxJump=Math.max(maxJump,Math.abs(sample(time+1/44100)-sample(time)));}
    assert.ok(maxJump<.09,'997 Hz synthetic sample must have no hard gain jump');
    t.mock.timers.tick(1100);
    t.mock.timers.tick(10); // The auto-clear now fades the wet route before removal.
    assert.equal(engine._chainExtensionNodes.length,0);
    assert.equal(engine._effectRouting.nodes.length,0);
  });
}
test('actual rapid Filter → Chop → Filter restores the requested filter and survives stale cleanup',t=>{
  const {engine}=setup(t,true);
  machine.updateContext({hasStarted:true,currentTrackId:'test:handoff',currentTrack:{id:'test:handoff'}});
  ims.beginSlowMomentary('test');ims.lockSlow();ims.setFilterXY(.4,.5);
  t.mock.timers.tick(10);const filter=engine._chainExtensionNodes[0];
  ims.fireChop(.5,.5);t.mock.timers.tick(2);ims.setFilterXY(.8,.2);
  t.mock.timers.tick(1000);
  assert.equal(ims.getSnapshot().performanceEffect,'FILTER');
  assert.equal(engine._chainExtensionNodes[0],filter);
  assert.equal(engine._effectRouting.nodes[0],filter);
});

test('effect fades remain complementary when cancelAndHoldAtTime is unavailable',t=>{
  const {engine,node}=setup(t),route=engine._effectRouting;
  delete route.dry.gain.cancelAndHoldAtTime;delete route.wet.gain.cancelAndHoldAtTime;
  const a=node(),b=node();engine.setChainExtension([a]);t.mock.timers.tick(4);
  engine.setChainExtension([b]);assertComplement(route,10.004,10.014);
  t.mock.timers.tick(10);assertComplement(route,10.014,10.024);
});
test('seek attenuation reaches zero before reposition and returns to unity across overlapping fades',t=>{
  const {engine}=setup(t);
  let position=10, mutedAtSeek=[];
  const audio=Object.assign(new EventTarget(),{src:'blob:track',duration:180,paused:false,ended:false,readyState:4,seeking:false});
  Object.defineProperty(audio,'currentTime',{get:()=>position,set:value=>{
    mutedAtSeek.push(engine._transitionGain.gain.value);position=value;
  }});
  engine._boundElement=audio;
  engine.mainGain.gain.value=.4;
  const primary=engine.source;
  engine.seek(52);t.mock.timers.tick(20);
  assert.equal(position,52);
  t.mock.timers.tick(5); // Start the next seek while the previous fade-in is incomplete.
  engine.seek(62);t.mock.timers.tick(20);
  t.mock.timers.tick(20);
  assert.ok(mutedAtSeek.every(value=>Math.abs(value)<1e-8));
  assert.equal(position,62);
  assert.equal(engine._transitionGain.gain.value,1);
  assert.equal(engine.mainGain.gain.value,.4);
  assert.equal(engine.source,primary);
});
test('seek timeout restores unity when the audio clock unexpectedly stops advancing',t=>{
  const {engine}=setup(t);
  engine._boundElement={src:'blob:track',currentTime:10,duration:180,paused:false,ended:false};
  const time=engine.ctx.currentTime;
  Object.defineProperty(engine.ctx,'currentTime',{value:time});
  engine.seek(52);t.mock.timers.tick(2000);
  assert.equal(engine._boundElement.currentTime,10);
  assert.equal(engine._pendingReposition,null);
});
