import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAudioEngine, getWebAudioEngine } from '../../audio/WebAudioEngine.js';
import { recoveryCoordinator } from '../recovery-coordinator.js';

function setup(t, engine = new WebAudioEngine()) {
  t.mock.timers.enable({apis:['setTimeout']});
  const changes = [];
  engine.ctx = {state:'running',currentTime:10};
  engine.mainGain = {gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(v){changes.push(v);}}};
  engine._boundElement = {src:'first',currentTime:5,paused:false,ended:false};
  t.after(() => engine.cancelPendingReposition());
  return {engine,changes};
}

test('owned stalled position repositions once and restores gain', t => {
  const {engine,changes} = setup(t);let calls=0;
  engine.rampAcrossReposition(()=>calls++);
  t.mock.timers.tick(20);
  assert.equal(calls,1);assert.deepEqual(changes,[0,1]);
});
for (const change of ['source','seek','pause','graph','suspend']) {
  test(`delayed recovery does not reposition after ${change}`,t=>{
    const {engine}=setup(t);let calls=0;
    engine.rampAcrossReposition(()=>calls++);
    if(change==='source') engine._boundElement.src='next';
    if(change==='seek') engine._boundElement.currentTime=20;
    if(change==='pause') engine._boundElement.paused=true;
    if(change==='graph') engine.mainGain={};
    if(change==='suspend') engine.ctx.state='suspended';
    t.mock.timers.tick(1000);assert.equal(calls,0);
  });
}
for(const method of ['resetForNewTrack','notifyStreamUpgrade','onPlaybackResumed']) {
  test(`${method} cancels pending reposition through the shared owner`,t=>{
    const {engine}=setup(t,getWebAudioEngine());let calls=0;
    engine.rampAcrossReposition(()=>calls++);
    recoveryCoordinator[method]();t.mock.timers.tick(1000);
    assert.equal(calls,0);assert.equal(engine._pendingReposition,null);
  });
}
test('superseding a faded operation retains the original restoration target',t=>{
  const {engine,changes}=setup(t);let old=0;let next=0;
  engine.rampAcrossReposition(()=>old++);
  engine.mainGain.gain.value=0;
  engine.rampAcrossReposition(()=>next++);
  t.mock.timers.tick(20);
  assert.equal(old,0);assert.equal(next,1);assert.equal(changes.at(-1),1);
});
