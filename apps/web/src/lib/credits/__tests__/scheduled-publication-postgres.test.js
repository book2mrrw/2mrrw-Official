import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createCreditDatabaseFixture} from '../../../../scripts/credits-postgres-fixture.mjs';

const release='11111111-1111-4111-8111-111111111111';
const migration='supabase/migrations/20261027021450_repair_scheduled_lyric_publication.sql';
async function fixture(products=1) {
  const db=await createCreditDatabaseFixture();
  await db.exec(await fs.readFile(migration,'utf8'));
  await db.query("INSERT INTO releases(id,title,slug,status,release_type,content_kind,available_at) VALUES($1,'Scheduled','scheduled-fixture','scheduled','album','music','2030-01-01Z')",[release]);
  for(let i=0;i<products;i++) await db.query("INSERT INTO products(slug,title,product_type,price_cents,release_id,active,metadata) VALUES($1,'Scheduled','album',100,$2,false,$3)",['scheduled-fixture-'+i,release,JSON.stringify({lyrics:'[00:01.000]Kept exactly'})]);
  return db;
}
const activate=db=>db.query("SELECT * FROM activate_scheduled_release($1,'2030-01-02Z')",[release]);

test('historical activation reproduces ambiguous slug, forward migration activates atomically and retains lyrics',async()=>{
 const db=await fixture();try{
  await db.exec(await fs.readFile('supabase/migrations/20260827000053_activate_scheduled_release_requires_product.sql','utf8'));
  await assert.rejects(activate(db),e=>e.code==='42702');
  await db.exec(await fs.readFile(migration,'utf8'));
  assert.deepEqual((await activate(db)).rows,[{activated:true,release_id:release,slug:'scheduled-fixture'}]);
  assert.equal((await db.query('SELECT status FROM releases WHERE id=$1',[release])).rows[0].status,'published');
  const p=(await db.query('SELECT active,metadata FROM products WHERE release_id=$1',[release])).rows[0];
  assert.equal(p.active,true);assert.equal(p.metadata.lyrics,'[00:01.000]Kept exactly');
  assert.equal((await activate(db)).rows[0].activated,false);
 }finally{await db.close();}
});
test('not-due, archived, deleted and missing releases cannot activate',async()=>{
 const db=await fixture();try{
  assert.equal((await db.query("SELECT * FROM activate_scheduled_release($1,'2029-01-01Z')",[release])).rows[0].activated,false);
  for(const state of ["status='archived'","status='scheduled',deleted_at=now()"]){
   await db.query('UPDATE releases SET '+state+' WHERE id=$1',[release]);
   assert.equal((await activate(db)).rows[0].activated,false);
  }
  assert.equal((await db.query("SELECT * FROM activate_scheduled_release('99999999-9999-4999-8999-999999999999','2030-01-02Z')")).rows[0].activated,false);
  assert.equal((await db.query('SELECT active FROM products WHERE release_id=$1',[release])).rows[0].active,false);
 }finally{await db.close();}
});
test('zero, duplicate and deleted products roll back the release transition',async()=>{
 for(const count of [0,2,1]){
  const db=await fixture(count);try{
   if(count===1)await db.query('UPDATE products SET deleted_at=now() WHERE release_id=$1',[release]);
   await assert.rejects(activate(db),/expected exactly one products row/);
   assert.equal((await db.query('SELECT status FROM releases WHERE id=$1',[release])).rows[0].status,'scheduled');
   assert.ok((await db.query('SELECT active FROM products WHERE release_id=$1',[release])).rows.every(p=>!p.active));
  }finally{await db.close();}
 }
});
test('activation is service-role only with a fixed search path',async()=>{
 const db=await fixture();try{
  const rows=(await db.query("SELECT role,has_function_privilege(role,'public.activate_scheduled_release(uuid,timestamptz)','EXECUTE') AS allowed FROM unnest(ARRAY['anon','authenticated','service_role']) role")).rows;
  assert.deepEqual(rows.map(r=>r.allowed),[false,false,true]);
  assert.deepEqual((await db.query("SELECT proconfig FROM pg_proc WHERE oid='public.activate_scheduled_release(uuid,timestamptz)'::regprocedure")).rows[0].proconfig,['search_path=public, pg_temp']);
 }finally{await db.close();}
});
