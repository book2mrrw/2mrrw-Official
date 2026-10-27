import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebAudioEngine } from '../../audio/WebAudioEngine.js';
import { attachTransportCommands } from '../PlaybackTransportCommands.js';

function setup(t) {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const engine=getWebAudioEngine();
  const saved={ctx:engine.ctx,mainGain:engine.mainGain,_transitionGain:engine._transitionGain,
    _boundElement:engine._boundElement,_pendingReposition:engine._pendingReposition};
  const automation=[];
  engine.ctx={state:'running',get currentTime(){return 10+Date.now()/1000;}};
  engine.mainGain={gain:{value:.4}};
  engine._transitionGain={gain:{value:1,cancelScheduledValues(){},setValueAtTime(value,time){automation.push(['hold',value,time]);},
    linearRampToValueAtTime(value,time){automation.push(['ramp',value,time]);}}};
  let position=10;const seeks=[];
  const audio=Object.assign(new EventTarget(),{src:'blob:active',readyState:4,paused:false,ended:false,seeking:false,duration:180});
  Object.defineProperty(audio,'currentTime',{get:()=>position,set:value=>{seeks.push(value);position=value;audio.seeking=true;audio.dispatchEvent(new Event('seeking'));}});
  engine._boundElement=audio;
  const progress=[];
  const refs={audioRef:{current:audio},stateRef:{current:{currentTrack:{id:'one',metadata:{access:{canStream:true}}},playbackState:'playing'}},
    playRequestIdRef:{current:1},commandRequestIdRef:{current:1},pendingSeekRef:{current:null},
    tracePlayback(){},logDirectInternalCallViolation(){},syncProgressTime:v=>progress.push(v),syncPositionState(){}};
  const command={_deps:refs};attachTransportCommands(command);
  t.after(()=>{engine.cancelPendingReposition();Object.assign(engine,saved);});
  return {engine,audio,command,refs,seeks,progress,automation,advancePlayback:()=>{position+=.015;},
    ready(){audio.seeking=false;audio.dispatchEvent(new Event('seeked'));}};
}

test('shared full-song seek fades, tolerates normal advancement and waits for seek readiness',t=>{
  const h=setup(t);
  h.command.seekInternal(52);
  assert.deepEqual(h.seeks,[]);
  assert.deepEqual(h.automation.at(-1),['ramp',0,10.02]);
  h.advancePlayback();t.mock.timers.tick(20);
  assert.deepEqual(h.seeks,[52]);
  assert.deepEqual(h.progress,[52]);
  assert.equal(h.engine._pendingReposition.seeking,true);
  assert.equal(h.automation.at(-1)[1],0);
  h.ready();
  assert.equal(h.engine._pendingReposition,null);
  assert.equal(h.automation.at(-1)[1],1);
  assert.equal(h.engine.mainGain.gain.value,.4);
});
test('rapid scrubbing commits only the latest target and restores the original fader',t=>{
  const h=setup(t);
  h.command.seekInternal(20);t.mock.timers.tick(5);
  h.refs.commandRequestIdRef.current++;h.command.seekInternal(30);t.mock.timers.tick(5);
  h.refs.commandRequestIdRef.current++;h.command.seekInternal(40);t.mock.timers.tick(20);
  assert.deepEqual(h.seeks,[40]);h.ready();
  assert.equal(h.automation.at(-1)[1],1);
  assert.equal(h.engine._pendingReposition,null);
});
for(const reason of ['pause','request','recording','access','source','external-seek','suspend','graph']) {
  test('pending user seek cannot apply after '+reason,t=>{
    const h=setup(t);h.command.seekInternal(52);
    if(reason==='pause'){h.audio.paused=true;h.audio.dispatchEvent(new Event('pause'));}
    if(reason==='request')h.refs.commandRequestIdRef.current++;
    if(reason==='recording')h.refs.stateRef.current.currentTrack={id:'two'};
    if(reason==='access')h.refs.stateRef.current.currentTrack={id:'one',metadata:{access:{canStream:false,previewOnly:true}}};
    if(reason==='source')h.audio.src='blob:next';
    if(reason==='external-seek')h.audio.dispatchEvent(new Event('seeking'));
    if(reason==='suspend')h.engine.ctx.state='suspended';
    if(reason==='graph')h.engine._transitionGain={gain:{}};
    t.mock.timers.tick(100);
    assert.deepEqual(h.seeks,[]);assert.equal(h.engine._pendingReposition,null);
  });
}
test('paused seeks are immediate and never play or allocate a graph',t=>{
  const h=setup(t);h.audio.paused=true;
  h.command.seekInternal(52);
  assert.deepEqual(h.seeks,[52]);assert.equal(h.engine._pendingReposition,null);
  assert.deepEqual(h.automation,[]);
});
test('loading seeks remain queued and preview seeks remain denied',t=>{
  const h=setup(t);h.audio.readyState=0;
  h.command.seekInternal(52);assert.equal(h.refs.pendingSeekRef.current,52);
  assert.deepEqual(h.seeks,[]);assert.deepEqual(h.automation,[]);
  h.audio.readyState=4;h.refs.stateRef.current.currentTrack.metadata.access.previewOnly=true;
  h.command.seekInternal(88);assert.equal(h.refs.pendingSeekRef.current,52);
  assert.deepEqual(h.seeks,[]);assert.deepEqual(h.automation,[]);
});
test('missing seeked event has a bounded unmute and stale events cannot affect the next seek',t=>{
  const h=setup(t);h.command.seekInternal(52);t.mock.timers.tick(20);
  t.mock.timers.tick(2000);assert.equal(h.engine._pendingReposition,null);
  assert.equal(h.automation.at(-1)[1],1);
  h.refs.commandRequestIdRef.current++;h.command.seekInternal(62);
  const pending=h.engine._pendingReposition;
  h.audio.dispatchEvent(new Event('seeked'));
  assert.equal(h.engine._pendingReposition,pending);
  t.mock.timers.tick(20);h.ready();assert.deepEqual(h.seeks,[52,62]);
});

test('rapid relative skip commands accumulate against the latest owned seek target',t=>{
  const h=setup(t);h.command.seekForward(15);
  h.refs.commandRequestIdRef.current++;h.command.seekForward(15);
  t.mock.timers.tick(20);assert.deepEqual(h.seeks,[40]);h.ready();
  h.command.seekInternal(100);
  h.refs.commandRequestIdRef.current++;h.command.seekBack(15);
  h.refs.commandRequestIdRef.current++;h.command.seekBack(15);
  t.mock.timers.tick(20);assert.deepEqual(h.seeks,[40,70]);h.ready();
});
