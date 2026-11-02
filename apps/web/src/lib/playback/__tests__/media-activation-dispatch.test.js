import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchPlaybackCommand } from '../command-dispatcher.js';
import { getAudioEngineRuntime } from '../audio-engine-runtime.js';
import { isMediaActivationSource } from '../../audio/media-activation.js';

function environment(t){
 for(const [key,value] of Object.entries({window:{},document:{visibilityState:'visible'},navigator:{userActivation:{isActive:true}}})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});
  t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
 }
 return getAudioEngineRuntime().refs;
}

test('real dispatcher captures on the existing element before returning, then serializes source preparation',async t=>{
 const refs=environment(t);let resolve;const permission=new Promise(r=>{resolve=r;});const order=[];
 const audio=Object.assign(new EventTarget(),{src:'',paused:true,play(){order.push('gesture-play');this.paused=false;return permission;},pause(){order.push('activation-stop');this.paused=true;}});
 refs.audioRef.current=audio;refs.initWebAudioRef.current=()=>order.push('context-init');refs.stateGetterRef.current=()=>({});
 refs.commandHandlersRef.current={setQueue(){},async playTrack(){assert.equal(audio.paused,true);assert.ok(isMediaActivationSource(audio));order.push('protected-source');audio.src='/protected';return true;}};
 const result=dispatchPlaybackCommand('PLAY_TRACK',{track:{id:'a'}});
 assert.deepEqual(order,['context-init','gesture-play']);assert.equal(refs.audioRef.current,audio);
 await Promise.resolve();assert.equal(order.includes('protected-source'),false);
 resolve();assert.equal(await result,true);assert.deepEqual(order,['context-init','gesture-play','activation-stop','protected-source']);
});

test('emergency pause finishes while gesture activation is still pending',async t=>{
 const refs=environment(t);const order=[];
 const audio=Object.assign(new EventTarget(),{src:'',paused:true,play(){return new Promise(()=>{});},pause(){this.paused=true;}});
 refs.audioRef.current=audio;refs.stateGetterRef.current=()=>({});
 refs.commandHandlersRef.current={setQueue(){},async playTrack(){order.push('prepare');return false;},pause(){order.push('pause');audio.pause();}};
 const playing=dispatchPlaybackCommand('PLAY_TRACK',{track:{id:'a'}});
 assert.equal(await dispatchPlaybackCommand('PAUSE'),true);assert.ok(order.includes('pause'));
 await playing;assert.equal(audio.paused,true);
});
