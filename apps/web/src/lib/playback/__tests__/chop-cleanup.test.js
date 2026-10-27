import test from 'node:test';
import assert from 'node:assert/strict';
import { getWebAudioEngine } from '../../audio/WebAudioEngine.js';
import { interactiveMediaState as ims } from '../../../media/InteractiveMediaState.js';
import { playbackStateMachine as machine } from '../../../media/PlaybackStateMachine.js';
import '../../../media/effects/ChopEngine.js';
import '../../../media/effects/FilterEngine.js';

function setup(t) {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const engine = getWebAudioEngine();
  const original = {ctx:engine.ctx,bassFilter:engine.bassFilter,limiter:engine.limiter,_chainExtensionNodes:engine._chainExtensionNodes,
    _effectRouting:engine._effectRouting,_effectChange:engine._effectChange};
  const param = () => ({value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}});
  const node = () => ({gain:param(),frequency:param(),Q:param(),connections:new Set(),
    connect(other){this.connections.add(other);},disconnect(){this.connections.clear();}});
  engine.ctx = {state:'running',get currentTime(){return 10+Date.now()/1000;},createGain:node,createBiquadFilter:node};
  engine.bassFilter=node();engine.limiter=node();engine._chainExtensionNodes=[];
  engine._effectRouting=null;engine._effectChange=null;
  engine._applyChain(engine.bassFilter,engine.limiter);
  const previous = machine.getContext();
  machine.updateContext({currentTrackId:'audit:first',currentTrack:{id:'audit:first',slug:'audit-first'}});
  ims.beginSlowMomentary('audit');ims.lockSlow();
  t.after(() => {ims.unlockSlow();ims.deactivateFilter();t.mock.timers.tick(1000);machine.updateContext(previous);Object.assign(engine,original);});
  return {engine};
}

test('actual Chop cancellation disconnects its node after fading to dry', t => {
  const {engine}=setup(t);
  ims.fireChop(.5,.5);const chop=engine._chainExtensionNodes[0];
  ims.unlockSlow();
  assert.equal(ims.getSnapshot().performanceEffect,'NONE');
  assert.equal(engine._chainExtensionNodes.length,0);
  t.mock.timers.tick(10);
  assert.equal(chop.connections.size,0);
  t.mock.timers.tick(1000);
  assert.equal(engine._chainExtensionNodes.length,0);
});

test('actual track identity change clears a running Chop burst', t => {
  const {engine}=setup(t);
  ims.fireChop(.5,.5);const chop=engine._chainExtensionNodes[0];
  machine.updateContext({currentTrackId:'audit:next',currentTrack:{id:'audit:next',slug:'audit-next'}});
  assert.equal(ims.getSnapshot().performanceEffect,'NONE');
  assert.equal(engine._chainExtensionNodes.length,0);
  t.mock.timers.tick(10);
  assert.equal(chop.connections.size,0);
});

test('repeated actual Chop bursts release the predecessor and clear the final owner', t => {
  const {engine}=setup(t);
  ims.fireChop(1,1);const first=engine._chainExtensionNodes[0];
  ims.fireChop(0,0);const second=engine._chainExtensionNodes[0];
  assert.notEqual(first,second);
  t.mock.timers.tick(10);
  assert.equal(first.connections.size,0);
  t.mock.timers.tick(1000);
  assert.equal(engine._chainExtensionNodes.length,0);
  assert.equal(ims.getSnapshot().performanceEffect,'NONE');
});

test('Chop cancellation cannot later clear an actual Filter handoff', t => {
  const {engine}=setup(t);
  ims.fireChop(1,1);const chop=engine._chainExtensionNodes[0];
  ims.setFilterXY(.4,.5);const filter=engine._chainExtensionNodes[0];
  assert.notEqual(chop,filter);
  t.mock.timers.tick(10);
  assert.equal(chop.connections.size,0);
  t.mock.timers.tick(1000);
  assert.equal(engine._chainExtensionNodes[0],filter);
  assert.equal(ims.getSnapshot().performanceEffect,'FILTER');
});

test('a stale Filter deactivation cannot clear a successor Chop node', t => {
  const {engine}=setup(t);
  ims.setFilterXY(.4,.5);ims.deactivateFilter();ims.fireChop(0,.5);
  const chop=engine._chainExtensionNodes[0];
  t.mock.timers.tick(140);
  assert.equal(engine._chainExtensionNodes[0],chop);
  assert.equal(ims.getSnapshot().performanceEffect,'CHOP');
});
