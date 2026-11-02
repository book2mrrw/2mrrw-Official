import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMediaActivation, finishMediaActivation, cancelMediaActivation, isMediaActivationSource } from '../../audio/media-activation.js';
import { WebAudioEngine } from '../../audio/WebAudioEngine.js';
import { AUDIO_ENGINE_EVENTS as E } from '../../audio/AudioEngineInterface.js';
function media(play) {
  return Object.assign(new EventTarget(), { src:'', paused:true, currentTime:0, plays:0, pauses:0,
    play(){this.plays++;this.paused=false;return play?.call(this) ?? Promise.resolve();},
    pause(){this.pauses++;this.paused=true;} });
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
test('cold activation calls play synchronously on the supplied element and finishes before loading', async () => {
  const p=deferred();const audio=media(()=>p.promise);
  captureMediaActivation(audio,{userActive:true});assert.equal(audio.plays,1);assert.equal(isMediaActivationSource(audio),true);
  const bytes=Buffer.from(audio.src.split(',')[1],'base64');assert.equal(bytes.readUInt32LE(40),160);assert.ok(bytes.subarray(44).every(x=>x===128));
  let loaded=false;const waiting=finishMediaActivation(audio).then(()=>{loaded=true;audio.src='/authorized';});
  await Promise.resolve();assert.equal(loaded,false);p.resolve();await waiting;
  assert.equal(audio.paused,true);assert.equal(audio.src,'/authorized');
  captureMediaActivation(audio,{userActive:true});assert.equal(audio.plays,1);
});
for(const paused of [true,false]) test(`loaded media is untouched (paused=${paused})`,async()=>{
  const audio=media();Object.assign(audio,{src:'/current',currentTime:71,paused});
  captureMediaActivation(audio,{userActive:true});await finishMediaActivation(audio);
  assert.equal(audio.src,'/current');assert.equal(audio.currentTime,71);assert.equal(audio.paused,paused);assert.equal(audio.plays,0);
});
test('programmatic commands and duplicate taps do not create activation operations',async()=>{
  const p=deferred();const audio=media(()=>p.promise);
  captureMediaActivation(audio,{userActive:false});assert.equal(audio.plays,0);
  captureMediaActivation(audio,{userActive:true});captureMediaActivation(audio,{userActive:true});assert.equal(audio.plays,1);
  p.resolve();await finishMediaActivation(audio);
});
test('a pause cancels activation; late completion cannot pause a successor',async()=>{
  const p=deferred();const audio=media(()=>p.promise);
  captureMediaActivation(audio,{userActive:true});cancelMediaActivation(audio);await finishMediaActivation(audio);const pauses=audio.pauses;
  audio.src='/successor';audio.paused=false;p.resolve();await Promise.resolve();assert.equal(audio.pauses,pauses);assert.equal(audio.paused,false);
});
test('an unsettled browser play has a bounded activation deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const audio=media(()=>new Promise(()=>{}));
  captureMediaActivation(audio,{userActive:true});let done=false;
  const result=finishMediaActivation(audio).then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);
  t.mock.timers.tick(1500);await result;assert.equal(audio.paused,true);
});
test('activation events never become track events; the same element forwards real media events',async()=>{
  const audio=media();const engine=new WebAudioEngine();engine._attachAudioElementListeners(audio);
  const seen=[];for(const e of [E.PLAY,E.ENDED,E.ERROR,E.PAUSE])engine.on(e,()=>seen.push(e));
  captureMediaActivation(audio,{userActive:true});for(const e of ['play','ended','error','pause'])audio.dispatchEvent(new Event(e));
  assert.deepEqual(seen,[]);await finishMediaActivation(audio);
  audio.src='/authorized';audio.dispatchEvent(new Event('ended'));assert.deepEqual(seen,[],'queued preparation events stay isolated until actual source loading');audio.dispatchEvent(new Event('loadstart'));audio.dispatchEvent(new Event('play'));audio.dispatchEvent(new Event('ended'));
  assert.deepEqual(seen,[E.PLAY,E.ENDED]);engine._detachAudioElementListeners();
});
