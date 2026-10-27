import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogRefreshStore,CATALOG_REFRESH_INTERVAL_MS} from '../catalog-refresh-store.js';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function browserGroup() {
 const channels=new Set(),environments=[];
 function tab({transport='broadcast'}={}) {
  const win=new EventTarget(),doc=new EventTarget(),intervals=new Map(),timeouts=new Map(),requests=[];
  let serial=0,answer='a'.repeat(64),fail=false,hold=false;
  Object.assign(doc,{visibilityState:'visible'});
  Object.assign(win,{
   navigator:{onLine:true},crypto:{randomUUID:()=>String(++serial)},
   setInterval(fn,ms){intervals.set(++serial,{fn,ms});return serial;},clearInterval:id=>intervals.delete(id),
   setTimeout(fn,ms){timeouts.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timeouts.delete(id),
   async fetch(url,options){
    const req={url,...options};requests.push(req);
    if(hold)await new Promise(resolve=>{req.resolve=resolve;options.signal.addEventListener('abort',resolve,{once:true});});
    return {ok:!fail,json:async()=>({revision:answer})};
   },
   localStorage:{setItem(key,newValue){for(const env of environments)if(env.window!==win)env.window.dispatchEvent(Object.assign(new Event('storage'),{key,newValue}));},removeItem(){}},
  });
  if(transport!=='storage')win.BroadcastChannel=class {
   constructor(name){if(transport==='blocked')throw new Error('blocked');this.name=name;channels.add(this);}
   postMessage(data){for(const peer of [...channels])if(peer!==this&&peer.name===this.name)peer.onmessage?.({data});}
   close(){channels.delete(this);}
  };
  const env={window:win,document:doc};environments.push(env);
  return {env,requests,intervals,timeouts,store:createCatalogRefreshStore(()=>env),
   answer(value){answer=value;},fail(value){fail=value;},hold(value){hold=value;},
   async tick(){for(const t of [...intervals.values()]){assert.equal(t.ms,CATALOG_REFRESH_INTERVAL_MS);await t.fn();}await flush();},
   async event(name){(name==='visibilitychange'?doc:win).dispatchEvent(new Event(name));await flush();},
  };
 }
 return {tab,channels};
}
test('separate documents receive mutations without echo loops, including an editor with no subscriber',async()=>{
 const group=browserGroup(),a=group.tab(),b=group.tab();let observed=0;
 const stopA=a.store.subscribeCatalogRefresh(()=>{}),stopB=b.store.subscribeCatalogRefresh(()=>observed++);
 await flush();const before=observed;
 a.store.signalCatalogMutation('lyrics_saved');assert.equal(observed,before+1);
 assert.equal(a.store.getCatalogRefreshRevision(),2);assert.equal(b.store.getCatalogRefreshRevision(),2);
 stopA();a.store.signalCatalogMutation('publish');assert.equal(observed,before+2);
 for(const channel of group.channels)channel.onmessage?.({data:{version:1,type:'catalog-invalidated',catalog:{lyrics:'untrusted'}}});
 assert.equal(observed,before+2);
 stopB();assert.equal(group.channels.size,0);
});
test('storage transport covers absent and blocked BroadcastChannel',async()=>{
 for(const transport of ['storage','blocked']){
  const group=browserGroup(),a=group.tab({transport}),b=group.tab({transport});
  const stop=b.store.subscribeCatalogRefresh(()=>{});await flush();const before=b.store.getCatalogRefreshRevision();
  a.store.signalCatalogMutation();assert.equal(b.store.getCatalogRefreshRevision(),before+1);stop();
 }
});
test('one bounded poll is shared; only authoritative version changes invalidate consumers',async()=>{
 const a=browserGroup().tab();let observed=0;
 const stopA=a.store.subscribeCatalogRefresh(()=>observed++),stopB=a.store.subscribeCatalogRefresh(()=>{});
 await flush();assert.equal(a.requests.length,1);assert.equal(a.intervals.size,1);assert.equal(observed,1);
 assert.equal(a.requests[0].cache,'no-store');assert.equal(a.requests[0].url,'/api/catalog/releases?view=revision');
 await a.tick();assert.equal(observed,1);
 a.answer('b'.repeat(64));await a.tick();assert.equal(observed,2);
 a.fail(true);a.answer('c'.repeat(64));await a.tick();assert.equal(observed,2);
 a.fail(false);a.answer('invalid');await a.tick();assert.equal(observed,2);
 a.answer('c'.repeat(64));await a.event('focus');assert.equal(observed,3);
 stopA();assert.equal(a.intervals.size,1);stopB();assert.equal(a.intervals.size,0);assert.equal(a.timeouts.size,0);
});
test('hidden/offline documents pause, resume on visibility/online, and abort pending work on unsubscribe',async()=>{
 const a=browserGroup().tab();a.env.document.visibilityState='hidden';
 let observed=0;const stop=a.store.subscribeCatalogRefresh(()=>observed++);await flush();await a.tick();assert.equal(a.requests.length,0);
 a.env.document.visibilityState='visible';a.env.window.navigator.onLine=false;await a.event('visibilitychange');assert.equal(a.requests.length,0);
 a.env.window.navigator.onLine=true;await a.event('online');assert.equal(observed,1);
 a.hold(true);a.answer('d'.repeat(64));a.env.window.dispatchEvent(new Event('focus'));await flush();
 const pending=a.requests.at(-1);await a.event('focus');assert.equal(a.requests.length,2,'no overlapping request');
 stop();await flush();assert.equal(pending.signal.aborted,true);assert.equal(observed,1);assert.equal(a.intervals.size,0);assert.equal(a.timeouts.size,0);
 await a.event('focus');assert.equal(a.requests.length,2);
 a.hold(false);const again=a.store.subscribeCatalogRefresh(()=>observed++);await flush();assert.equal(observed,2);again();
});
test('poll timeout aborts and leaves the next tick able to retry',async()=>{
 const a=browserGroup().tab();a.hold(true);const stop=a.store.subscribeCatalogRefresh(()=>{});await flush();
 for(const timer of a.timeouts.values()){assert.equal(timer.ms,10_000);timer.fn();}
 await flush();assert.equal(a.requests[0].signal.aborted,true);
 a.hold(false);await a.tick();assert.equal(a.requests.length,2);assert.equal(a.store.getCatalogRefreshRevision(),1);stop();
});
