import test from 'node:test';
import assert from 'node:assert/strict';
import {addTrackToPlaylist,createPlaylist,fetchAndSyncPlaylists,hasPendingWrites,loadPlaylists,reorderPlaylistTracks,savePlaylists,awaitPlaylistSave,migrateLocalToServer} from '../../src/lib/playlists.js';
import {playlistTrackKey} from '../../src/lib/playlists/identity.js';
const tick=()=>new Promise(r=>setImmediate(r));
function setup(t){
 const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
 const store=new Map();const win=new EventTarget();win.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 globalThis.window=win;
 t.after(()=>{globalThis.window=oldWindow;globalThis.fetch=oldFetch;});
}
async function settled(user){for(let i=0;i<100 && hasPendingWrites(user);i++)await tick();assert.equal(hasPendingWrites(user),false);}
const a={slug:'intro',albumSlug:'album-a',src:'/a'},b={slug:'intro',albumSlug:'album-b',src:'/b'};
test('rapid create/add/reorder writes serialize and use acknowledged revisions',async t=>{
 setup(t);const user='queue-user';const requests=[];
 globalThis.fetch=async(path,options)=>{
  const body=JSON.parse(options.body);requests.push({path,body});await tick();
  return Response.json(path==='/api/playlists'?{playlist:{revision:0}}:{revision:body.revision+1});
 };
 const playlist=createPlaylist(user,{title:'test'});
 addTrackToPlaylist(user,playlist.id,a);addTrackToPlaylist(user,playlist.id,b);
 reorderPlaylistTracks(user,playlist.id,[playlistTrackKey(b),playlistTrackKey(a)]);
 await settled(user);
 assert.deepEqual(requests.slice(1).map(r=>r.body.revision),[0,1,2]);
 const result=loadPlaylists(user)[0];assert.equal(result.revision,3);assert.deepEqual(result.tracks.map(t=>t.albumSlug),['album-b','album-a']);
});
test('conflict is persisted visibly and dependent writes do not continue',async t=>{
 setup(t);const user='conflict-user';savePlaylists(user,[{id:'p',revision:0,tracks:[],trackIds:[]}]);let writes=0;
 globalThis.fetch=async()=>{writes++;return Response.json({error:'conflict'},{status:409});};
 addTrackToPlaylist(user,'p',a);addTrackToPlaylist(user,'p',b);await settled(user);
 assert.equal(writes,1);assert.ok(loadPlaylists(user)[0].syncError);assert.equal(loadPlaylists(user)[0].tracks.length,2);
 await fetchAndSyncPlaylists(user);assert.equal(writes,1);
 globalThis.fetch=async()=>Response.json({playlists:[{id:'p',revision:4,tracks:[],trackIds:[]}]});
 await fetchAndSyncPlaylists(user,{discardUnsaved:true});assert.equal(loadPlaylists(user)[0].syncError,undefined);
});
test('late hydration cannot erase edits made while its GET was pending',async t=>{
 setup(t);const user='hydrate-user';savePlaylists(user,[{id:'p',revision:0,tracks:[],trackIds:[]}]);let release;
 globalThis.fetch=async(path,options={})=>options.method?Response.json({revision:1}):new Promise(r=>{release=r;});
 const hydration=fetchAndSyncPlaylists(user);await tick();addTrackToPlaylist(user,'p',a);await settled(user);
 release(Response.json({playlists:[{id:'p',revision:0,tracks:[],trackIds:[]}]}));await hydration;
 assert.equal(loadPlaylists(user)[0].tracks.length,1);assert.equal(loadPlaylists(user)[0].revision,1);
});
test('guest edits use the same identity and ordering without network access',t=>{
 setup(t);globalThis.fetch=()=>assert.fail('guest must stay local');const pl=createPlaylist('guest',{title:'guest'});
 addTrackToPlaylist('guest',pl.id,a);addTrackToPlaylist('guest',pl.id,b);addTrackToPlaylist('guest',pl.id,a);
 const keys=[playlistTrackKey(b),playlistTrackKey(a)];reorderPlaylistTracks('guest',pl.id,keys);
 assert.deepEqual(loadPlaylists('guest')[0].trackIds,keys);
});
test('interrupted writes survive reload as visibly unsaved rather than being overwritten',async t=>{
 setup(t);const user='interrupted-user';savePlaylists(user,[{id:'p',revision:1,tracks:[a],trackIds:[playlistTrackKey(a)],syncPending:true}]);
 globalThis.fetch=()=>assert.fail('must not silently overwrite interrupted edits');
 assert.match(loadPlaylists(user)[0].syncError,/interrupted/);await fetchAndSyncPlaylists(user);
 assert.equal(loadPlaylists(user)[0].tracks.length,1);
});
test('revoked entitlement rejects save acknowledgement and retains the unsaved tracks',async t=>{
 setup(t);const user='revoked-user';savePlaylists(user,[{id:'p',revision:0,tracks:[],trackIds:[]}]);let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({error:'not entitled'},{status:403});};
 addTrackToPlaylist(user,'p',a);
 await assert.rejects(awaitPlaylistSave(user,'p'));
 await settled(user);
 assert.ok(loadPlaylists(user)[0].syncError);
 await fetchAndSyncPlaylists(user);
 assert.equal(requests,1);assert.equal(loadPlaylists(user)[0].tracks.length,1);
});
test('legacy import entitlement failure cannot trigger hydration that erases local tracks',async t=>{
 setup(t);const user='legacy-denied-user';savePlaylists(user,[{id:'pl_old',title:'Old playlist',tracks:[a],trackIds:[playlistTrackKey(a)]}]);
 const calls=[];
 globalThis.fetch=async(path,options={})=>{
  calls.push([path,options.method]);
  if(!options.method)return Response.json({playlists:[]});
  if(path==='/api/playlists')return Response.json({playlist:{revision:0}});
  return Response.json({error:'not entitled'},{status:403});
 };
 await migrateLocalToServer(user);await fetchAndSyncPlaylists(user);
 assert.match(loadPlaylists(user)[0].syncError,/import/);
 assert.equal(loadPlaylists(user)[0].tracks[0].albumSlug,'album-a');
 assert.equal(window.localStorage.getItem('2mrrw_playlists_migrated:'+user),null);
 await migrateLocalToServer(user);assert.equal(calls.length,3);
});
