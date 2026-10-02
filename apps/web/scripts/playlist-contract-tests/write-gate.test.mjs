import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent('export function resolve(s,c,next){return next(s === "next/server" ? "next/server.js" : s,c);}'),import.meta.url);
import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {playlistWriteGateResponse} from '../../src/lib/playlists/write-gate.js';

let user={id:'listener'}, databaseCalls=0;
mock.module('@/lib/auth/session-user',{namedExports:{getFanSessionUser:async()=>user}});
mock.module('@/lib/server/rate-limit',{namedExports:{checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({}, {status:429})}});
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>{
  databaseCalls++;
  const query={select(){return this;},eq(){return this;},order(){return this;},
    then(resolve,reject){return Promise.resolve({data:[]}).then(resolve,reject);}};
  return {from:()=>query};
}}});
const root=await import('../../src/app/api/playlists/route.js');
const detail=await import('../../src/app/api/playlists/[id]/route.js');
const tracks=await import('../../src/app/api/playlists/[id]/tracks/route.js');

test('cutover blocks every playlist mutation before database access, preserves reads and auth',async()=>{
  const previous=process.env.PLAYLIST_WRITES_PAUSED;
  process.env.PLAYLIST_WRITES_PAUSED='1';
  try {
    for(const [handler,method] of [[root.POST,'POST'],[detail.PATCH,'PATCH'],[detail.DELETE,'DELETE'],[tracks.POST,'POST'],[tracks.PUT,'PUT'],[tracks.DELETE,'DELETE']]){
      const response=await handler(new Request('http://localhost/api/playlists',{method}),{params:Promise.resolve({id:'playlist'})});
      assert.equal(response.status,503);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('retry-after'),'60');
      assert.equal((await response.json()).code,'PLAYLIST_WRITES_PAUSED');
    }
    assert.equal(databaseCalls,0);
    const read=await root.GET(new Request('http://localhost/api/playlists'));
    assert.equal(read.status,200);
    assert.deepEqual(await read.json(),{playlists:[]});
    assert.equal(databaseCalls,1);
    user=null;
    assert.equal((await root.POST(new Request('http://localhost/api/playlists',{method:'POST'}))).status,401);
    user={id:'listener',isGuest:true};
    assert.equal((await root.POST(new Request('http://localhost/api/playlists',{method:'POST'}))).status,401);
    assert.equal(databaseCalls,1);
    delete process.env.PLAYLIST_WRITES_PAUSED;
    assert.equal(playlistWriteGateResponse(),null);
    process.env.PLAYLIST_WRITES_PAUSED='0';
    assert.equal(playlistWriteGateResponse(),null);
  } finally {
    user={id:'listener'};
    if(previous===undefined) delete process.env.PLAYLIST_WRITES_PAUSED;
    else process.env.PLAYLIST_WRITES_PAUSED=previous;
  }
});
