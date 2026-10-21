/** Synthetic fixtures in disposable PostgreSQL 17. Never accepts a remote URL. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
const {default:EmbeddedPostgres}=await import(process.env.RELEASE_TEST_POSTGRES_MODULE || '/private/tmp/2mrrw-release-db-test/node_modules/embedded-postgres/dist/index.js');
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const root=await mkdtemp(join(tmpdir(),'release-deletion-pg-'));
const pg=new EmbeddedPostgres({databaseDir:join(root,'db'),port,user:'postgres',password:randomUUID(),authMethod:'scram-sha-256',persistent:false,createPostgresUser:false,postgresFlags:['-h','127.0.0.1','-k',root,'-c','statement_timeout=5000'],onLog:()=>{},onError:()=>{}});
const clients=[],checks=[];let started=false;
const migration=await readFile(new URL('../../supabase/migrations/20261020210000_release_deletion_lifecycle.sql',import.meta.url),'utf8');
const actor=randomUUID(),listener=randomUUID();
try {
 await pg.initialise();await pg.start();started=true;
 async function connect(){const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);return c;}
 const db=await connect(),a=await connect(),b=await connect();
 const version=(await db.query('show server_version')).rows[0].server_version;assert.match(version,/^17\./);
 await db.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');
 create table public.admin_principals(user_id uuid primary key references auth.users(id));
 create table public.releases(id uuid primary key,slug text unique,status text check(status in ('draft','scheduled','published','archived')),release_type text,storefront_visible boolean,upcoming_visible boolean default false,unavailable_at timestamptz);
 create table public.products(id uuid primary key,slug text unique,release_id uuid references releases(id),product_type text,release_type text,active boolean);
 create table public.tracks(id uuid primary key,release_id uuid references releases(id),audio_r2_key text);
 create table public.catalog_tracks(id uuid primary key,product_id uuid references products(id),album_slug text);
 create table public.release_drafts(release_id uuid references releases(id),draft_payload jsonb);
 create table public.draft_deletion_jobs(release_id uuid references releases(id));
 create table public.purchase_history(product_id uuid references products(id),amount int);
 alter table releases enable row level security;alter table products enable row level security;alter table tracks enable row level security;alter table catalog_tracks enable row level security;alter table release_drafts enable row level security;
 create policy public_read on releases for select using(true);create policy public_read on products for select using(true);create policy public_read on tracks for select using(true);create policy public_read on catalog_tracks for select using(true);create policy public_read on release_drafts for select using(true);
 grant usage on schema public to anon,authenticated,service_role;grant select on all tables in schema public to anon,authenticated,service_role;`);
 await db.query('insert into auth.users(id) values($1),($2)',[actor,listener]);await db.query('insert into admin_principals values($1)',[actor]);
 await db.query(migration);
 const call=(c,id,who=actor)=>c.query('select delete_release($1,$2) result',[id,who]);
 async function fixture(type,status='published',legacy=false,alias=false){
  const rid=randomUUID(),pid=randomUUID(),slug=`${type}-${rid}`;
  if(!legacy)await db.query('insert into releases values($1,$2,$3,$4,true,false,null,null)',[rid,slug,status,type]);
  await db.query('insert into products values($1,$2,$3,$4,$5,true,null)',[pid,alias?slug+'-alias':slug,legacy?null:rid,['ep','mixtape'].includes(type)?'album':type,type]);
  if(!legacy){await db.query('insert into tracks values($1,$2,$3)',[randomUUID(),rid,'shared/audio.flac']);await db.query("insert into release_drafts values($1,'{}')",[rid]);}
  await db.query('insert into catalog_tracks values($1,$2,$3)',[randomUUID(),pid,alias?slug+'-alias':slug]);
  await db.query('insert into purchase_history values($1,299)',[pid]);return {rid,pid,slug};
 }
 for(const type of ['single','feature','album','ep','mixtape'])for(const status of ['draft','published']){
  const f=await fixture(type,status);const first=(await call(db,f.rid)).rows[0].result;
  assert.equal(first.ok,true);assert.equal(first.semantics,'soft_delete');
  assert.equal((await call(db,f.pid)).rows[0].result.deleted_at,first.deleted_at);
  assert.equal((await db.query('select active from products where id=$1',[f.pid])).rows[0].active,false);
  for(const [table,key,id] of [['tracks','release_id',f.rid],['purchase_history','product_id',f.pid],['catalog_tracks','product_id',f.pid],['release_drafts','release_id',f.rid]])assert.equal((await db.query(`select count(*)::int n from ${table} where ${key}=$1`,[id])).rows[0].n,1);
  for(const role of ['anon','authenticated']){
   await db.query(`set role ${role}`);
   for(const [table,key,id] of [['products','id',f.pid],['tracks','release_id',f.rid],['catalog_tracks','product_id',f.pid],['release_drafts','release_id',f.rid]])assert.equal((await db.query(`select count(*)::int n from ${table} where ${key}=$1`,[id])).rows[0].n,0);
   await assert.rejects(call(db,f.rid),{code:'42501'});await db.query('reset role');
  }
  await assert.rejects(db.query('update products set active=true where id=$1',[f.pid]),{code:'55000'});
  await assert.rejects(db.query("update releases set status='published' where id=$1",[f.rid]),{code:'55000'});
  await assert.rejects(db.query('update products set deleted_at=null where id=$1',[f.pid]),{code:'55000'});
  checks.push(`${type}/${status}: retries, RLS, relationships retained, reactivation rejected`);
 }
 for(const type of ['single','feature','album']){const f=await fixture(type,'published',true);assert.equal((await call(db,f.pid)).rows[0].result.ok,true);checks.push(`legacy ${type}: product-only deletion`);}
 const collision=await fixture('album');
 await db.query(`insert into releases values($1,$2,'published','single',true,false,null,null)`,[collision.pid,'different-release-'+collision.pid]);
 assert.equal((await db.query("select delete_release($1,$2,false,'catalog') result",[collision.pid,actor])).rows[0].result.slug,collision.slug);
 assert.equal((await db.query('select deleted_at from releases where id=$1',[collision.pid])).rows[0].deleted_at,null);checks.push('explicit catalog source disambiguates identical UUIDs across tables');
 const alias=await fixture('feature','published',false,true);const aliasResult=(await call(db,alias.rid)).rows[0].result;
 assert.deepEqual(new Set(aliasResult.deleted_slugs),new Set([alias.slug,alias.slug+'-alias']));checks.push('linked alias tombstoned atomically');
 const denied=await fixture('single');await assert.rejects(call(db,denied.rid,listener),{code:'42501'});
 assert.equal((await db.query('select active from products where id=$1',[denied.pid])).rows[0].active,true);checks.push('listener actor denied without mutation');
 assert.equal((await call(db,randomUUID())).rows[0].result.code,'release_not_found');checks.push('missing record returns explicit failure');
 const published=await fixture('feature');assert.equal((await db.query('select delete_release($1,$2,true) result',[published.rid,actor])).rows[0].result.code,'release_no_longer_draft');checks.push('legacy draft cleanup cannot delete a newly published release');
 const serviceFixture=await fixture('single');await db.query('set role service_role');
 assert.equal((await call(db,serviceFixture.rid)).rows[0].result.ok,true);
 await assert.rejects(db.query('delete from release_deletions'),{code:'42501'});
 await assert.rejects(db.query('update release_deletions set deleted_at=now()'),{code:'42501'});
 await db.query('reset role');checks.push('service role can call attributed RPC but cannot erase tombstones');
 const rollback=await fixture('album');
 await db.query(`create function reject_deletion_test() returns trigger language plpgsql as $$begin if new.deleted_at is not null then raise exception 'simulated write failure';end if;return new;end$$;create trigger zz_test_failure before update on products for each row execute function reject_deletion_test()`);
 await assert.rejects(call(db,rollback.rid));
 assert.equal((await db.query('select status from releases where id=$1',[rollback.rid])).rows[0].status,'published');
 assert.equal((await db.query('select count(*)::int n from release_deletions where slug=$1',[rollback.slug])).rows[0].n,0);
 await db.query('drop trigger zz_test_failure on products');checks.push('write failure rolls back tombstone and release');
 const concurrent=await fixture('feature');await a.query('begin');await call(a,concurrent.rid);
 const pending=call(b,concurrent.pid);await a.query('commit');assert.equal((await pending).rows[0].result.ok,true);checks.push('concurrent release-ID and product-ID retries serialize');
 const retained=await fixture('album');await db.query('begin');await call(db,retained.rid);await db.query('rollback');
 assert.equal((await db.query('select active from products where id=$1',[retained.pid])).rows[0].active,true);checks.push('rollback preserves unrelated release and shared audio');
 console.log(JSON.stringify({postgres:version,productionTouched:false,passed:checks.length,checks},null,2));
} finally {for(const c of clients)await c.end().catch(()=>{});if(started)await pg.stop();await rm(root,{recursive:true,force:true});}
