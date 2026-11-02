import test from 'node:test';
import assert from 'node:assert/strict';
import { waitAudioSrcReady, playAudioIfNotPaused, loadAudioSrcAndPlay } from '../../audio/audio-element-utils.js';
import { waitForPlaybackBuffer } from '../../audio/playback-buffer.js';
import { requestMediaPlay, classifyMediaFailure } from '../../audio/media-play-request.js';
const authority={effectAuthorityMode:'CORE',effectAuthority:{},canApplyEffect:()=>true};
function media(play){return Object.assign(new EventTarget(),{src:'',paused:true,ended:false,readyState:1,networkState:0,
 currentTime:0,duration:180,loads:0,plays:0,pauses:0,buffered:{length:0},load(){this.loads++;},pause(){this.pauses++;this.paused=true;},
 play(){this.plays++;return play?.call(this) ?? Promise.resolve().then(()=>{this.paused=false;});}});}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('native metadata-only startup requests real playback without spending a prebuffer deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const audio=media();await waitAudioSrcReady(audio,'/protected',{readiness:'playback'});
 await waitForPlaybackBuffer(audio,{transport:'native-hls'});
 assert.equal(audio.loads,1);assert.equal(audio.readyState,1);assert.equal(audio.plays,0);
 assert.equal(await playAudioIfNotPaused(audio,true,authority),true);assert.equal(audio.plays,1);
});
test('MSE startup still waits for its existing buffered runway',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const audio=media();let settled=false;
 const pending=waitForPlaybackBuffer(audio,{transport:'mse-hls'}).then(()=>{settled=true;});
 await Promise.resolve();assert.equal(settled,false);
 audio.readyState=3;audio.buffered={length:1,start:()=>0,end:()=>4};audio.dispatchEvent(new Event('progress'));
 await pending;assert.equal(settled,true);
});
test('permission rejection is classified, logged with name/code, and never blindly retried',async t=>{
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
 const audio=media(()=>Promise.reject(new DOMException('permission blocked','NotAllowedError')));let failure;
 assert.equal(await playAudioIfNotPaused(audio,true,{...authority,onFailure:f=>{failure=f;}}),false);
 assert.equal(audio.plays,1);assert.equal(failure.category,'permission');
 const log=logs.find(x=>x[1]?.code==='AUDIO_RESUME_FAILED')?.[1];
 assert.equal(log.errorName,'NotAllowedError');assert.equal(log.errorCode,0);assert.equal(log.failureCategory,'permission');
});
test('denied authority and a pre-aborted load never call play',async()=>{
 const audio=media();assert.equal(await playAudioIfNotPaused(audio,true,{...authority,canApplyEffect:()=>false}),null);
 const ctrl=new AbortController();ctrl.abort();assert.equal(await playAudioIfNotPaused(audio,true,{...authority,signal:ctrl.signal}),null);
 assert.equal(audio.plays,0);
});
test('native play deadline pauses the stalled request and late resolution cannot resurrect it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const p=deferred();const audio=media(()=>p.promise);
 let category;const result=playAudioIfNotPaused(audio,true,{...authority,timeoutMs:100,onFailure:f=>{category=f.category;}});
 t.mock.timers.tick(100);assert.equal(await result,false);assert.equal(category,'timeout');assert.equal(audio.paused,true);
 audio.paused=false;p.resolve();await Promise.resolve();assert.equal(audio.paused,true);
});
test('cancelled old promise cannot pause a successor using the same source',async()=>{
 const old=deferred();const audio=media(()=>old.promise);const ctrl=new AbortController();
 const first=requestMediaPlay(audio,{signal:ctrl.signal}).catch(e=>e.name);ctrl.abort();assert.equal(await first,'AbortError');
 audio.play=function(){this.paused=false;return Promise.resolve();};await requestMediaPlay(audio);
 old.resolve();await Promise.resolve();assert.equal(audio.paused,false);
});
test('source cancellation settles without retrying or changing the successor source',async()=>{
 const p=deferred();const audio=media(()=>p.promise);audio.src='/old';const ctrl=new AbortController();
 const first=playAudioIfNotPaused(audio,true,{...authority,signal:ctrl.signal});audio.src='/new';ctrl.abort();
 assert.equal(await first,null);assert.equal(audio.src,'/new');assert.equal(audio.plays,1);p.resolve();
});
test('media failures distinguish network, unsupported, authentication, and cancellation',()=>{
 assert.equal(classifyMediaFailure({}, {error:{code:2}}),'network');
 assert.equal(classifyMediaFailure({name:'NotSupportedError'}),'unsupported');
 assert.equal(classifyMediaFailure({status:403}),'authentication');
 assert.equal(classifyMediaFailure({name:'AbortError'}),'cancelled');
});


test('the shared load-and-play helper also lets native playback drive metadata-only loading', async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const audio=media();audio.canPlayType=()=> 'probably';
 assert.equal(await loadAudioSrcAndPlay(audio,'/protected',authority),true);
 assert.equal(audio.loads,1);assert.equal(audio.plays,1);
});
