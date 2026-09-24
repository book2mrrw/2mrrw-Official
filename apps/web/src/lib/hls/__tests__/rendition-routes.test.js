import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
// Match Next's extensionless server import in Node's test-only resolver.
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent('export function resolve(s,c,next){return next(s === "next/server" ? "next/server.js" : s,c);}'),import.meta.url);
mock.module('next/server' ,{namedExports:{NextResponse:Response}});
let row, cache, reads, authorized=true;
mock.module('@/lib/server/media-cors',{namedExports:{applyMediaCors:(_,r)=>r,mediaCorsPreflightResponse:()=>new Response()}});
mock.module('@/lib/auth/session-user',{namedExports:{getFanSessionUser:async()=>authorized?{id:'user'}:null}});
mock.module('@/lib/guest-session',{namedExports:{getGuestUser:async()=>null}});
mock.module('@/lib/auth/constants',{namedExports:{isAdminUser:()=>true}});
mock.module('@/lib/commerce/entitlements',{namedExports:{userCanStreamProduct:async()=>true}});
mock.module('@/lib/releases/release-availability-server',{namedExports:{resolveReleaseAccessForProduct:async()=>({})}});
mock.module('@/lib/hls/token',{namedExports:{signVariantToken:async()=> 'signed',signKeyToken:async()=> 'key',verifyVariantToken:async()=>authorized?{slug:'song',bitrate:'64k',userId:'user'}:null}});
mock.module('@/lib/hls/derive-key',{namedExports:{deriveHLSIV:async()=>Buffer.alloc(16)}});
mock.module('@/lib/server/rate-limit',{namedExports:{checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>new Response(null,{status:429})}});
mock.module('@/lib/server/hls-manifest-cache',{namedExports:{getOrFetchManifest:async(_,__,factory)=>cache??(cache=await factory())}});
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>({from:()=>{
 const q={select:s=>{assert.equal(s,'*');return q;},eq:()=>q,is:()=>q,maybeSingle:async()=>{reads++;return {data:row};}};return q;
}})}});
const master=await import('../../../app/api/library/hls/route.js');
const variant=await import('../../../app/api/library/hls/variant/route.js');
const req=(query)=>({nextUrl:new URL('https://example.test/api?'+query)});
for(const order of ['master','variant']) test(`${order}-first shared cache preserves measured bandwidth and durations`,async()=>{
 cache=undefined;reads=0;authorized=true;
 row={bitrates:['64k'],hls_prefix:'audio/song/',segment_counts:{'64k':2},segment_duration_secs:6,duration_seconds:7,rendition_metadata:{'64k':{version:1,target_duration:6,bandwidth:81000,average_bandwidth:75000,segment_durations:[6.014,0.986]}}};
 const m=()=>master.GET(req('slug=song'));const v=()=>variant.GET(req('slug=song&bitrate=64k&token=signed'));
 if(order==='master') await m();else await v();
 assert.match(await (await m()).text(),/BANDWIDTH=81000,AVERAGE-BANDWIDTH=75000/);
 const body=await (await v()).text();assert.match(body,/#EXTINF:6.014000,/);assert.match(body,/#EXTINF:0.986000,/);assert.match(body,/seg_00002.ts/);
 assert.equal(reads,1);
});
test('legacy rows keep old playlists and denied requests never read metadata',async()=>{
 cache=undefined;reads=0;authorized=true;
 row={bitrates:['64k'],hls_prefix:'audio/song/',segment_counts:{'64k':2},segment_duration_secs:6,duration_seconds:7};
 assert.match(await(await master.GET(req('slug=song'))).text(),/BANDWIDTH=72000,CODECS/);
 assert.match(await(await variant.GET(req('slug=song&bitrate=64k&token=signed'))).text(),/#EXTINF:1.000000,/);
 cache=undefined;reads=0;authorized=false;
 assert.equal((await master.GET(req('slug=song'))).status,401);
 assert.equal((await variant.GET(req('slug=song&bitrate=64k&token=signed'))).status,401);
 assert.equal(reads,0);
});
