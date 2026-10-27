import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
const react=await import('react');
mock.module('react',{namedExports:{...react,useCallback:fn=>fn,useMemo:fn=>fn()}});
mock.module('../../playback-core/production/wireProductionCore.js',{namedExports:{getProductionPlaybackCore:()=>({port:{}})}});
const {usePlaybackPublicApi}=await import('../usePlaybackPublicApi.js');
const {getWebAudioEngine}=await import('../../audio/WebAudioEngine.js');
const {interactiveMediaState:ims}=await import('../../../media/InteractiveMediaState.js');
await import('../../../media/effects/ScrewEngine.js');

function setup(t) {
  const engine=getWebAudioEngine(),saved={...engine};
  const old=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{href:'https://test.invalid/'}}});
  const audio=Object.assign(new EventTarget(),{src:'https://test.invalid/base.mp3',currentTime:12,duration:180,
    paused:true,readyState:4,playbackRate:1,preservesPitch:true,pause(){this.paused=true;},load(){}});
  Object.defineProperty(audio,'currentSrc',{get:()=>new URL(audio.src,window.location.href).href});
  engine._boundElement=audio;engine._basePresentations=new WeakMap();engine._screwPlaybackRate=null;
  const refs=new Proxy({audioRef:{current:audio},csModeRef:{current:false},csHoldActiveRef:{current:false},
    csHoldSavedRef:{current:null},stateRef:{current:{currentTrack:{id:'one',csAudio:'/cs.mp3'}}}},
    {get:(o,k)=> k in o ? o[k] : (o[k]={current:null})});
  // React is mocked above: call the real callback factory without rendering.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const api=usePlaybackPublicApi({refs,delegates:{}});
  t.after(()=>{ims.unlockSlow();Object.assign(engine,saved);
    if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;});
  return {engine,audio,api,refs};
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

test('CS hold rate callbacks preserve live Screw and restore normal presentation',t=>{
  const {audio,api}=setup(t);
  ims.beginSlowMomentary('test');ims.lockSlow();
  const rate=audio.playbackRate;
  api.setCsHoldPlaybackRate(.8);
  assert.equal(audio.playbackRate,rate);assert.equal(audio.preservesPitch,false);
  api.endCsHoldPreview();
  assert.equal(audio.playbackRate,rate);assert.equal(audio.preservesPitch,false);
  ims.unlockSlow();assert.equal(audio.playbackRate,1);assert.equal(audio.preservesPitch,true);
});
test('CS source preview saves the base presentation rather than baking in live Screw',async t=>{
  const {audio,api,engine}=setup(t);
  engine.applyPlaybackPresentation(audio,{playbackRate:.9});
  ims.beginSlowMomentary('test');ims.lockSlow();
  const rate=audio.playbackRate;
  api.beginCsHoldPreview('/cs.mp3');await flush();
  assert.equal(audio.playbackRate,rate);assert.equal(audio.preservesPitch,false);
  api.endCsHoldPreview();await flush();
  assert.equal(audio.playbackRate,rate);assert.equal(audio.preservesPitch,false);
  ims.unlockSlow();assert.equal(audio.playbackRate,.9);assert.equal(audio.preservesPitch,true);
  assert.equal(audio.currentSrc,'https://test.invalid/base.mp3');
});
