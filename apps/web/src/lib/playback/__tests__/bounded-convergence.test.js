import '../../playback-core/__tests__/physical/dom-shim.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWiredCore } from '../../playback-core/production/wireProductionCore.js';
import { getAudioEngineRuntime } from '../audio-engine-runtime.js';
import { flush } from './recovery-fixture.mjs';

for(const outcome of ['false','reject','no-progress']) {
  test(`Core bounds ${outcome} across convergence passes and permits a new intent`,async t=>{
    t.mock.timers.enable({apis:['setTimeout','Date']});
    let calls=0,failures=0,allow=false;
    const physical={mediaIdentity:null,transport:'PAUSED',position:0};
    const failureRef=getAudioEngineRuntime().refs.recoveryFailureRef;
    failureRef.current=()=>failures++;
    const core=buildWiredCore({loggerEnabled:false,probe:{snapshot:()=>({...physical})},dispatch:async(type,payload)=>{
      calls++;
      if(allow){physical.mediaIdentity=payload.track?.id || 'a';physical.transport='PLAYING';return true;}
      if(outcome==='reject')throw Error('unavailable');
      return outcome==='no-progress'?true:false;
    }});
    t.after(()=>{core.destroy();failureRef.current=null;});
    core.port.play({trackId:'a',queueEntries:[{id:'a',slug:'a',src:'/a'}],queueIndex:0});
    assert.equal(calls,1,'intent dispatch stays synchronous');
    for(let i=0;i<10;i++){await flush();t.mock.timers.tick(1000);}
    await flush();assert.equal(calls,3);assert.equal(failures,1);
    assert.equal(core._executionEngine.failure.code,'PLAYBACK_RECOVERY_EXHAUSTED');
    for(let i=0;i<4;i++){t.mock.timers.tick(10000);await flush();await core._executionEngine.converge('extra-pass');}
    assert.equal(calls,3,'later passes cannot reset the same failure budget');
    allow=true;core.port.play({trackId:'a',queueEntries:[{id:'a',slug:'a',src:'/a'}],queueIndex:0});
    assert.equal(calls,4);await flush();t.mock.timers.tick(0);await flush();
    assert.equal(physical.transport,'PLAYING');assert.equal(core._executionEngine.failure,null);
  });
}
