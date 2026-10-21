import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSaveQueue } from '../draft-save-queue.js';
test('queued snapshots serialize and use the revision returned by the previous write',async()=>{
  const calls=[];let releaseFirst;
  const queue=createDraftSaveQueue({send:async(snapshot,revision)=>{calls.push({snapshot,revision});if(calls.length===1)await new Promise(r=>releaseFirst=r);return {ok:true,saved_at:`revision-${calls.length}`};}});
  queue.restoreRevision('initial');
  const first=queue.enqueue({data:'first'});const second=queue.enqueue({data:'second'});
  await Promise.resolve();await Promise.resolve();assert.equal(calls.length,1);releaseFirst();await Promise.all([first,second]);assert.equal(calls[1].revision,'revision-1');
});
test('duplicate flushes do not resave a snapshot or advance its revision',async()=>{
  let count=0;const queue=createDraftSaveQueue({send:async()=>({ok:true,saved_at:`r${++count}`})});
  await queue.enqueue({value:1});await queue.enqueue({value:1});assert.equal(count,1);
});
test('a failed request preserves values and does not claim they were saved',async()=>{
  const states=[];const snapshot={name:'Entered Name'};const queue=createDraftSaveQueue({send:async()=>({ok:false,status:503,error:'Unavailable'}),onState:s=>states.push(s)});
  await assert.rejects(()=>queue.enqueue(snapshot),/Unavailable/);assert.equal(snapshot.name,'Entered Name');assert.equal(states.at(-1).status,'error');
});
test('a conflict prevents automatic retries from overwriting another editor',async()=>{
  let calls=0;const queue=createDraftSaveQueue({send:async()=>{calls++;return {ok:false,status:409,error:'Conflict'};}});
  await assert.rejects(()=>queue.enqueue({value:1}),/Conflict/);await assert.rejects(()=>queue.enqueue({value:2}),/Conflict/);assert.equal(calls,1);
});
test('publication pause prevents an unmount flush from resurrecting a saved draft',async()=>{
  let count=0;const queue=createDraftSaveQueue({send:async()=>({ok:true,saved_at:`r${++count}`})});
  await queue.enqueue({value:1});queue.pause();await queue.enqueue({value:2});assert.equal(count,1);queue.resume();await queue.enqueue({value:2});assert.equal(count,2);
});
