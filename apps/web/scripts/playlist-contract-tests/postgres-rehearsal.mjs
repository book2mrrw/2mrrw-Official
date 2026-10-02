/** Disposable native PostgreSQL only; never accepts a remote connection URL.
 * PLAYLIST_POSTGRES_MODULE=/absolute/path/to/embedded-postgres/dist/index.js node scripts/playlist-contract-tests/postgres-rehearsal.mjs
 * Runtime is installed separately; no application dependency changes needed.
 */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

assert.ok(process.env.PLAYLIST_POSTGRES_MODULE,'Set PLAYLIST_POSTGRES_MODULE to a separately installed native runtime');
const {default:EmbeddedPostgres}=await import(process.env.PLAYLIST_POSTGRES_MODULE);
const probe=createServer();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
const root=await mkdtemp(join(tmpdir(),'playlist-postgres-'));
const diagnostics=[];
const pg=new EmbeddedPostgres({databaseDir:join(root,'db'),port,user:'postgres',password:randomUUID(),
  authMethod:'scram-sha-256',persistent:false,createPostgresUser:false,
  postgresFlags:['-h','127.0.0.1','-k',root,'-c','statement_timeout=10000'],
  onLog:message=>diagnostics.push(String(message)),onError:error=>diagnostics.push(String(error))});
const clients=[],checks=[];
const user=randomUUID(),other=randomUUID();
let started=false;
async function connect(){const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);return c;}
const migration=await readFile(new URL('../../supabase/migrations/20261001010000_playlist_identity_transactions.sql',import.meta.url),'utf8');
const original=await readFile(new URL('../../supabase/migrations/20260729000000_user_playlists.sql',import.meta.url),'utf8');
const key=(album,track)=>JSON.stringify([album,track]);
const mutate=(c,id,rev,action,payload,actor=user)=>c.query('select public.mutate_playlist_tracks($1,$2,$3,$4,$5) result',[id,actor,rev,action,payload]);
try {
  await pg.initialise();await pg.start();started=true;
  const observer=await connect(),a=await connect(),b=await connect();
  const version=(await observer.query('show server_version')).rows[0].server_version;
  assert.match(version,/^17\./);
  await observer.query(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.catalog_tracks(album_slug text,slug text);`);
  await observer.query(original);
  await observer.query('grant select,insert,update,delete on user_playlists,playlist_tracks to authenticated,service_role');
  await observer.query('insert into auth.users values($1),($2)',[user,other]);
  const create=async()=> (await observer.query('insert into user_playlists(user_id) values($1) returning id',[user])).rows[0].id;
  const legacy=await create();
  await observer.query("insert into catalog_tracks values('release','song')");
  await a.query('begin');
  const originalEntry=(await a.query("insert into playlist_tracks(playlist_id,album_slug,track_slug,sort_order,track_data) values($1,'release','release',7,'{\"trackSlug\":\"song\"}') returning id",[legacy])).rows[0].id;
  // A real legacy writer holds a table lock. Migration must abort, not partially apply.
  await assert.rejects(b.query(migration),{code:'55P03'});
  await b.query('rollback');
  assert.equal((await observer.query("select count(*)::int n from information_schema.columns where table_name='user_playlists' and column_name='revision'")).rows[0].n,0);
  await a.query('commit');await observer.query(migration);
  const repaired=(await observer.query('select id,track_slug,sort_order from playlist_tracks where playlist_id=$1',[legacy])).rows[0];
  assert.deepEqual(repaired,{id:originalEntry,track_slug:'song',sort_order:7});
  checks.push('migration lock timeout rolls back; retry preserves and repairs legacy identity');

  const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  async function confirmBlocked(){
    for(let i=0;i<200;i++){
      const blockers=(await observer.query('select pg_blocking_pids($1) ids',[pidB])).rows[0].ids;
      if(blockers.includes(pidA))return;
      await delay(10);
    }
    assert.fail('second connection never waited for the first playlist lock');
  }
  const playlist=await create();
  await a.query('begin');await mutate(a,playlist,0,'add',{albumSlug:'a',trackSlug:'intro'});
  const losingAdd=mutate(b,playlist,0,'add',{albumSlug:'b',trackSlug:'intro'}).then(()=>({ok:true}),e=>({code:e.code}));
  await confirmBlocked();
  // A separate playlist remains writable while the first is locked.
  const independent=await create();await mutate(observer,independent,0,'add',{trackSlug:'independent'});
  await a.query('commit');assert.deepEqual(await losingAdd,{code:'40001'});
  assert.equal((await observer.query('select revision::int from user_playlists where id=$1',[playlist])).rows[0].revision,1);
  assert.equal((await observer.query('select count(*)::int n from playlist_tracks where playlist_id=$1',[playlist])).rows[0].n,1);
  checks.push('simultaneous same-revision additions serialize; stale writer rejected; other playlists remain writable');

  await mutate(observer,playlist,1,'add',{albumSlug:'b',trackSlug:'intro'});
  await a.query('begin');await mutate(a,playlist,2,'reorder',{keys:[key('b','intro'),key('a','intro')]});
  const losingRemove=mutate(b,playlist,2,'remove',{keys:[key('a','intro')]}).then(()=>({ok:true}),e=>({code:e.code}));
  await confirmBlocked();await a.query('commit');assert.deepEqual(await losingRemove,{code:'40001'});
  const order=(await observer.query('select album_slug from playlist_tracks where playlist_id=$1 order by sort_order',[playlist])).rows.map(r=>r.album_slug);
  assert.deepEqual(order,['b','a']);
  checks.push('concurrent reorder and removal cannot commit a stale order or erase an entry');

  await assert.rejects(mutate(observer,playlist,3,'remove',{keys:[key('a','intro')]},other),{code:'42501'});
  for(const role of ['anon','authenticated','service_role']){
    await observer.query(`set role ${role}`);
    try {
      for(const sql of ['delete from playlist_tracks','update playlist_tracks set sort_order=0',"insert into playlist_tracks(playlist_id,track_slug) values($1,'bypass')"])
        await assert.rejects(observer.query(sql,sql.includes('$1')?[playlist]:[]),{code:'42501'});
      if(role!=='service_role')await assert.rejects(mutate(observer,playlist,3,'add',{trackSlug:'bypass'}),{code:'42501'});
      else await mutate(observer,playlist,3,'add',{trackSlug:'allowed-via-trusted-api'});
    } finally {await observer.query('reset role');}
  }
  checks.push('wrong owner and direct-write bypasses denied; service-only transaction remains callable');
  console.log(JSON.stringify({postgres:version,productionTouched:false,checks,passed:checks.length},null,2));
} catch(error) {
  console.error(diagnostics.slice(-8).join('\n'));throw error;
} finally {
  await Promise.allSettled(clients.map(c=>c.end()));
  if(started)await pg.stop();
  await rm(root,{recursive:true,force:true});
}
