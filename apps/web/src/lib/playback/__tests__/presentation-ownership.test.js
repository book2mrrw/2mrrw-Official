import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebAudioEngine, WebAudioEngine } from '../../audio/WebAudioEngine.js';
import { createPlaybackHelpers } from '../PlaybackHelperService.js';
import { attachTransportCommands } from '../PlaybackTransportCommands.js';
import { interactiveMediaState as ims } from '../../../media/InteractiveMediaState.js';
import '../../../media/effects/ScrewEngine.js';

function setup(t, baseRate=1) {
  const engine=getWebAudioEngine();
  const saved={_boundElement:engine._boundElement,_presentationElement:engine._presentationElement,
    _basePresentations:engine._basePresentations,_screwPlaybackRate:engine._screwPlaybackRate};
  const audio={playbackRate:1,preservesPitch:true,webkitPreservePitch:true,currentTime:12,duration:180};
  engine._basePresentations=new WeakMap();engine._screwPlaybackRate=null;engine._boundElement=audio;
  const helper=createPlaybackHelpers({csUsingAlternateSrcRef:{current:false}});
  helper.applyCsToElement(audio,{playbackRate:baseRate});
  t.after(()=>{ims.unlockSlow();Object.assign(engine,saved);});
  return {engine,audio,helper};
}
for(const base of [1,.75]) {
  test('registered Screw survives presentation and restores base '+base,t=>{
    const {engine,audio,helper}=setup(t,base);
    ims.beginSlowMomentary('test');ims.lockSlow();
    const rate=audio.playbackRate;
    assert.ok(rate<1);assert.equal(audio.preservesPitch,false);
    for(let i=0;i<3;i++)helper.applyCsToElement(audio,{playbackRate:base});
    assert.equal(audio.playbackRate,rate);assert.equal(audio.preservesPitch,false);
    assert.equal(ims.getSnapshot().playbackMode,'SLOW_LOCKED');
    assert.equal(audio.webkitPreservePitch,false);
    ims.setSlowIntensity(.8);
    assert.ok(Math.abs(audio.playbackRate-.69)<1e-9);
    ims.unlockSlow();
    assert.equal(audio.playbackRate,base);assert.equal(audio.preservesPitch,true);
    assert.equal(engine.getPlaybackPresentation(audio).playbackRate,base);
  });
}
test('base rate changes under Screw become effective when the effect ends',t=>{
  const {engine,audio}=setup(t);
  ims.beginSlowMomentary('test');
  const slowed=audio.playbackRate;
  const command={_deps:{audioRef:{current:audio},tracePlayback(){},logDirectInternalCallViolation(){}}};
  attachTransportCommands(command);command.setPlaybackRateInternal(.9);
  assert.equal(audio.playbackRate,slowed);assert.equal(audio.preservesPitch,false);
  ims.releaseMomentarySlow();
  assert.equal(audio.playbackRate,.9);assert.equal(audio.preservesPitch,true);
  assert.equal(engine.getPlaybackPresentation(audio).playbackRate,.9);
});
test('locked effect preserves a new base presentation for the next recording',t=>{
  const {audio,helper}=setup(t,.75);
  ims.beginSlowMomentary('test');ims.lockSlow();
  const slowed=audio.playbackRate;
  helper.applyCsToElement(audio,{playbackRate:1,useCsSrc:true});
  assert.equal(audio.playbackRate,slowed);assert.equal(audio.preservesPitch,false);
  ims.unlockSlow();assert.equal(audio.playbackRate,1);
});
test('unchanged presentation does not rewrite native rate or pitch',()=>{
  const engine=new WebAudioEngine();let rate=1,pitch=true,writes=0;
  const audio={get playbackRate(){return rate;},set playbackRate(v){writes++;rate=v;},
    get preservesPitch(){return pitch;},set preservesPitch(v){writes++;pitch=v;}};
  engine.applyPlaybackPresentation(audio,{playbackRate:1});
  engine.applyPlaybackPresentation(audio,{playbackRate:1});
  assert.equal(writes,0);
});
test('presentation and live effect work without a Web Audio graph',()=>{
  const engine=new WebAudioEngine(),audio={playbackRate:1,preservesPitch:true};
  engine.applyPlaybackPresentation(audio,{playbackRate:.75});
  engine.setScrewPlaybackRate(.7);engine.applyPlaybackPresentation(audio,{playbackRate:1});
  assert.equal(audio.playbackRate,.7);assert.equal(audio.preservesPitch,false);
  engine.setScrewPlaybackRate(null);
  assert.equal(audio.playbackRate,1);assert.equal(audio.preservesPitch,true);
});
