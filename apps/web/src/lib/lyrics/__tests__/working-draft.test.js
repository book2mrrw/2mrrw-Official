import test from 'node:test';
import assert from 'node:assert/strict';
import {createLyricWorkingDraft,lyricDraftKey} from '../working-draft.js';
const actor='author',release='release',recording='recording';
function fixture(options={}){
 const values=options.values||new Map();const states=[],restored=[],writes=[];let revision=options.revision??null,server=options.server??null,online=options.online!==false,pending=null;
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>{if(options.quota)throw Error('full');values.set(key,value);}};
 const request=async(url,init={})=>{
  if(!online)throw Error('offline');
  if(init.method!=='PATCH')return Response.json({ok:true,base_lyrics:'Published',revision,draft:server==null?null:{lyrics:server,base_lyrics:'Published',revision}});
  const body=JSON.parse(init.body);writes.push(body);
  if(body.expected_draft_revision!==revision)return Response.json({error:'A newer draft exists.'},{status:409});
  if(options.defer)await new Promise(resolve=>{pending=resolve;});
  revision='revision-'+writes.length;server=body.lyrics;return Response.json({ok:true,revision});
 };
 const make=extra=>createLyricWorkingDraft({authorId:actor,releaseId:release,recordingId:recording,baseline:'Published',value:'Published',storage,request,restore:value=>restored.push(value),onState:state=>states.push(state),delay:60000,...extra});
 return {values,states,restored,writes,make,online:value=>{online=value;},concurrent(value){revision='foreign';server=value;},finish(){pending?.();}};
}
test('typing writes a synchronous device recovery copy before any server debounce',async()=>{
 const f=fixture(),session=f.make();await session.start();session.buffer('Unfinished\n\nlyrics');assert.equal(JSON.parse(f.values.get(lyricDraftKey(actor,release,recording))).lyrics,'Unfinished\n\nlyrics');assert.equal(f.writes.length,0);session.dispose();
});
test('Save draft writes the exact unfinished document with the known revision',async()=>{
 const f=fixture(),session=f.make();await session.start();session.buffer('[2mrrw-draft:{"lines":[]}]');assert.equal(await session.save(),true);assert.equal(f.writes[0].lyrics,'[2mrrw-draft:{"lines":[]}]');assert.equal(f.states.at(-1).status,'saved');session.dispose();
});
test('refresh restores the saved device copy with its line breaks and partial cue string intact',async()=>{
 const f=fixture({online:false}),first=f.make();await first.start();const value='[2mrrw-draft:{"lines":[{"text":"Hold","time":1.25,"words":[]}]}]\nHold';first.buffer(value);first.dispose();const next=f.make();await next.start();assert.equal(f.restored.at(-1),value);assert.equal(f.states.at(-1).status,'local');next.dispose();
});
test('server drafts resume after leaving or on another device without a local copy',async()=>{
 const f=fixture({revision:'saved',server:'Half a song'}),session=f.make();await session.start();assert.equal(f.restored.at(-1),'Half a song');assert.equal(f.states.at(-1).status,'saved');session.dispose();
});
test('server errors never claim cloud durability and keep recovery available',async()=>{
 const f=fixture({online:false}),session=f.make();await session.start();session.buffer('Still working');assert.equal(await session.save(),false);assert.equal(f.states.at(-1).status,'local');assert.equal(f.states.at(-1).cachedLyrics,'Still working');session.dispose();
});
test('device storage failure remains explicit until a real server acknowledgement',async()=>{
 const f=fixture({quota:true}),session=f.make();await session.start();session.buffer('Work');assert.equal(f.states.at(-1).status,'error');assert.notEqual(f.states.at(-1).cachedLyrics,'Work');assert.equal(await session.save(),true);assert.equal(f.states.at(-1).cachedLyrics,'Work');session.dispose();
});
test('offline recovery syncs after reconnection without replacing the current text',async()=>{
 const f=fixture({online:false}),session=f.make();await session.start();session.buffer('Offline work');f.online(true);assert.equal(await session.save(),true);assert.equal(f.writes.at(-1).lyrics,'Offline work');session.dispose();
});
test('another editor cannot be overwritten by an old CAS token',async()=>{
 const f=fixture(),session=f.make();await session.start();session.buffer('This editor');f.concurrent('Other editor');assert.equal(await session.save(),false);assert.equal(f.states.at(-1).status,'conflict');assert.equal(JSON.parse(f.values.values().next().value).lyrics,'This editor');await session.review();assert.equal(f.states.at(-1).canChoose,true);session.choose(false);assert.equal(await session.save(),true);assert.equal(f.writes.at(-1).lyrics,'This editor');session.dispose();
});
test('conflict recovery can explicitly restore the newer saved draft',async()=>{
 const f=fixture(),session=f.make();await session.start();session.buffer('This editor');f.concurrent('Other editor');await session.save();await session.review();session.choose(true);assert.equal(f.restored.at(-1),'Other editor');session.dispose();
});
test('a save accepted just before refresh reconciles its lost acknowledgement without a false conflict',async()=>{
 const f=fixture(),session=f.make();await session.start();session.buffer('Same recovery text');f.concurrent('Same recovery text');assert.equal(await session.save(),true);assert.equal(f.states.at(-1).status,'saved');session.dispose();
});
test('a server acknowledgement for an older snapshot cannot label newer work as synced',async()=>{
 const f=fixture({defer:true}),session=f.make();await session.start();session.buffer('First');const pending=session.save();await new Promise(resolve=>setTimeout(resolve,0));session.buffer('Second');f.finish();await pending;assert.equal(f.states.at(-1).status,'local');assert.equal(JSON.parse(f.values.values().next().value).lyrics,'Second');session.dispose();
});
test('recovery identities are separated by account, release and recording',()=>{
 assert.notEqual(lyricDraftKey('a','r','one'),lyricDraftKey('b','r','one'));assert.notEqual(lyricDraftKey('a','r','one'),lyricDraftKey('a','r','two'));assert.notEqual(lyricDraftKey('a','r','one'),lyricDraftKey('a','other','one'));
});
test('Strict Mode restart aborts stale loading and can still hydrate the current draft',async()=>{
 const f=fixture({server:'Saved text',revision:'saved'}),session=f.make();const first=session.start();session.dispose();await session.start();await first;assert.equal(f.restored.at(-1),'Saved text');session.dispose();
});
test('opening and closing the editor without changes creates no draft writes',async()=>{
 const f=fixture(),session=f.make();await session.start();session.dispose();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.writes.length,0);
});
test('autosave coalesces nearby edits into the latest complete working copy',async()=>{
 const f=fixture(),session=f.make({delay:1});await session.start();session.buffer('First');session.buffer('Latest');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.writes.length,1);assert.equal(f.writes[0].lyrics,'Latest');assert.equal(f.states.at(-1).status,'saved');session.dispose();
});
test('a changed published baseline requires reopening instead of silently rebasing private work',async()=>{
 const f=fixture(),session=f.make({request:async()=>Response.json({ok:true,base_lyrics:'New published version',revision:'new',draft:null})});session.buffer('Private work');await session.start();assert.equal(f.states.at(-1).status,'conflict');assert.equal(await session.save(),false);assert.equal(JSON.parse(f.values.values().next().value).lyrics,'Private work');session.dispose();
});
test('a generic OK response without the draft revision never claims that the working copy was saved',async()=>{
 const f=fixture(),session=f.make({request:async(url,init={})=>Response.json(init.method==='PATCH'?{ok:true}:{ok:true,base_lyrics:'Published',revision:null,draft:null})});await session.start();session.buffer('Unfinished');assert.equal(await session.save(),false);assert.equal(f.states.at(-1).status,'local');assert.equal(f.states.at(-1).cachedLyrics,'Unfinished');session.dispose();
});
