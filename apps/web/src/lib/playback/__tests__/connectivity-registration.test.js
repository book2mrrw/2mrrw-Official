import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Collect the real hook's effect callbacks without mounting or rendering React.
const react = await import('react');
const effects = [];
mock.module('react', { namedExports: { ...react, useEffect: callback => effects.push(callback) } });
const { usePlaybackEffects } = await import('../usePlaybackEffects.js');
const { recoveryFixture, flush } = await import('./recovery-fixture.mjs');
const { getWebAudioEngine } = await import('../../audio/WebAudioEngine.js');

function setup(t) {
  const h = recoveryFixture(t);
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = new Map();
  const host = new EventTarget();
  const add = host.addEventListener.bind(host), remove = host.removeEventListener.bind(host);
  host.addEventListener = (type, cb, opts) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb); add(type, cb, opts);
  };
  host.removeEventListener = (type, cb, opts) => { listeners.get(type)?.delete(cb); remove(type, cb, opts); };
  Object.defineProperty(globalThis, 'window', { configurable:true, value:host });
  const engine = getWebAudioEngine();
  const old = { _boundElement:engine._boundElement, _elListeners:engine._elListeners,
    _listenerElement:engine._listenerElement, _onContextRunning:engine._onContextRunning };
  const noop = () => {};
  const delegates = new Proxy({...h.deps}, {get:(o,k)=> k in o ? o[k] : noop});
  h.audio.paused=false; h.audio.src=h.audio.currentSrc='blob:healthy';
  h.state.isPlaying=true; h.state.playbackState='playing';
  let forced=0, lightweight=0, stalls=0;
  h.deps.playTrackRef.current=()=>{forced++;};
  delegates.attemptLightweightPlaybackResume=()=>{lightweight++;return Promise.resolve(true);};
  delegates.startStallRecovery=()=>{stalls++;};
  effects.length=0;
  // React is mocked above: inspect real registration without a component render.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  usePlaybackEffects({refs:h.deps,delegates,publicApi:{},state:h.state,user:null,authLoading:false});
  const cleanups=effects.filter(cb=>/addEventListener\("(online|offline)"/.test(cb.toString())).map(cb=>cb());
  t.after(()=>{
    cleanups.reverse().forEach(cleanup=>cleanup?.());
    Object.assign(engine,old);
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;
  });
  return {...h,host,listeners,cleanups,counts:()=>({forced,lightweight,stalls})};
}

for (const condition of ['healthy','suspended','underrun','denied','paused','loading']) {
  test('actual hook connectivity registration: '+condition, async t=>{
    const h=setup(t);
    h.deps.streamErrorRetriedRef.current=2;
    if(condition==='suspended')h.context.state='suspended';
    if(condition==='underrun')h.audio.readyState=2;
    if(condition==='denied')h.state.accessDenied=true;
    if(condition==='paused')h.deps.userIntentPausedRef.current=true;
    if(condition==='loading')h.state.playbackState='loading';
    assert.equal(h.listeners.get('online')?.size,1);
    for(let i=0;i<3;i++)h.host.dispatchEvent(new Event('online'));
    await flush();
    assert.equal(h.counts().forced,0);
    assert.equal(h.counts().lightweight,condition==='suspended'?3:0);
    assert.equal(h.counts().stalls,condition==='underrun'?3:0);
    assert.equal(h.deps.playRequestIdRef.current,1);
    assert.equal(h.deps.streamErrorRetriedRef.current,2);
    assert.equal(h.audio.loads,0);
    assert.equal(h.audio.plays,0);
    assert.equal(h.deps.queueIndexRef.current,2);
  });
}

test('offline status clears on healthy reconnect without forcing play; listeners clean up',async t=>{
  const h=setup(t);
  h.host.dispatchEvent(new Event('offline'));
  assert.equal(h.state.error,'RECONNECTING');
  h.host.dispatchEvent(new Event('online'));await flush();
  assert.equal(h.state.error,null);assert.equal(h.state.isBuffering,false);
  assert.equal(h.counts().forced,0);
  h.cleanups.reverse().splice(0).forEach(fn=>fn?.());
  assert.equal(h.listeners.get('online').size,0);
  assert.equal(h.listeners.get('offline').size,0);
});

test('reconnect clears offline status after user pause without resuming',async t=>{
  const h=setup(t);h.host.dispatchEvent(new Event('offline'));
  h.deps.userIntentPausedRef.current=true;h.audio.paused=true;
  h.host.dispatchEvent(new Event('online'));await flush();
  assert.equal(h.state.error,null);assert.equal(h.state.isBuffering,false);
  assert.deepEqual(h.counts(),{forced:0,lightweight:0,stalls:0});
});
test('offline status cannot overwrite a terminal access error',t=>{
  const h=setup(t);h.state.accessDenied=true;h.state.error='Access unavailable';
  h.host.dispatchEvent(new Event('offline'));
  assert.equal(h.state.error,'Access unavailable');
  h.host.dispatchEvent(new Event('online'));assert.equal(h.counts().forced,0);
});
