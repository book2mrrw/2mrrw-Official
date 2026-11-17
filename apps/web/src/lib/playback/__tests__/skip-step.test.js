import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getWebAudioEngine } from '../../audio/WebAudioEngine.js';
import { attachTransportCommands } from '../PlaybackTransportCommands.js';

// Same harness as seek-envelope.test.js.
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


const clickEvent = { type: 'click', detail: 1, preventDefault() {}, stopPropagation() {} };

test('skip ±15 s steps 15 s even when a click event is forwarded as `seconds`', t => {
  const h = setup(t);
  h.command.seekForward(clickEvent); t.mock.timers.tick(20);
  assert.deepEqual(h.seeks, [25], 'forward 10 -> 25');
  h.ready();
  h.refs.commandRequestIdRef.current++;
  h.command.seekBack(clickEvent); t.mock.timers.tick(20);
  assert.deepEqual(h.seeks, [25, 10], 'back 25 -> 10');
});

test('explicit step sizes still apply; nonsense sizes fall back to 15 s', t => {
  const h = setup(t);
  h.command.seekForward(30); t.mock.timers.tick(20);
  assert.deepEqual(h.seeks, [40]);
  h.ready();
  h.refs.commandRequestIdRef.current++;
  h.command.seekBack(-5); t.mock.timers.tick(20);
  assert.deepEqual(h.seeks, [40, 25]);
});

test('the release modal skip buttons never forward the click event', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../../components/preview/ImmersivePreviewModal.js'), 'utf8');
  assert.match(src, /onClick=\{onSkipBack \? \(\) => onSkipBack\(\) : undefined\}/);
  assert.match(src, /onClick=\{onSkipFwd \? \(\) => onSkipFwd\(\) : undefined\}/);
});
