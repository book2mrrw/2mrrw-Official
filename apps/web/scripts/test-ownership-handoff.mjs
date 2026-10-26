// Isolated PostgreSQL tests. Set OWNERSHIP_PGLITE_MODULE to an installed PGlite entry.
// No production connection, auth, email, payments or media requests are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.OWNERSHIP_PGLITE_MODULE).href);
const ROOT = new URL('../src/',import.meta.url);
const instant = Date.now();
const id = () => crypto.randomUUID();
async function modules(db) {
  const context = vm.createContext({ Date, Buffer, console, Headers, process: { env: { NODE_ENV: 'test' } }, URL });
  async function load(path, deps = {}, dynamic = {}) {
    const source = await readFile(new URL(path,ROOT),'utf8');
    const mod = new vm.SourceTextModule(source, { context, identifier: path, importModuleDynamically: async spec => { if (!dynamic[spec]) throw Error('Unexpected dynamic import '+spec); return dynamic[spec]; } });
    await mod.link(async spec => {
      const value = deps[spec];
      if (value instanceof vm.Module) return value;
      if (!value) throw Error('Unmapped dependency '+spec+' in '+path);
      return new vm.SyntheticModule(Object.keys(value),function(){for(const[k,v] of Object.entries(value))this.setExport(k,v);},{context});
    });
    await mod.evaluate();return mod;
  }
  const proof = await load('lib/commerce/ownership-proof.js');
  const certificate = await load('lib/supabase/database-ca.js');
  const transaction = await load('lib/commerce/ownership-transaction.js', {'server-only':{}, '@/lib/supabase/database-ca':certificate, 'postgres':{default:()=>{throw Error('No real connection allowed');}}, '@/lib/supabase/supabase-url':{SUPABASE_URL:'https://fixture.supabase.co'}});
  const port = transaction.namespace.transactionAdmin(db);
  // Direct fixture reads are outside a transaction; service writes receive a fresh transaction port.
  port.transaction = false;
  const unified = await load('lib/commerce/unified-entitlements.js',{'@/lib/commerce/entitlements':{isMissingSupabaseTable:e=>e?.code==='42P01'}});
  const commerceSource = await readFile(new URL('lib/commerce/entitlements.js',ROOT),'utf8');
  const deps = {};
  // Explicit unsupported stubs fail loudly; tests exercise the actual grant path only.
  for(const match of commerceSource.matchAll(/(?:import|export)\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g)) {
    deps[match[2]] = Object.fromEntries(match[1].split(',').map(s=>s.trim()).filter(Boolean).map(n=>[n,()=>{throw Error('Unexpected commerce dependency '+n);} ]));
  }
  Object.assign(deps, {'crypto':{default:crypto},'@/lib/supabase/admin':{getAdminClient:()=>port},'@/lib/server/entitlement-cache':{...deps['@/lib/server/entitlement-cache'],invalidateUserEntitlementCache:async()=>{}}});
  const commerce = await load('lib/commerce/entitlements.js',deps,{'@/lib/commerce/unified-entitlements':unified,'@/lib/commerce/ownership-proof':proof});
  const flags = await load('lib/entitlements.js',{'@/lib/supabase/admin':{getAdminClient:()=>port},'@/lib/commerce/entitlements':{isMissingSupabaseTable:e=>e?.code==='42P01'},'@/lib/server/entitlement-cache':{invalidateEntitlementTierCache:async()=>{},invalidateUserEntitlementCache:async()=>{}}});
  const resolver = await load('lib/commerce/resolve-storefront-product.js',{'@/lib/commerce/catalog':{getProductCatalog:()=>[]}});
  const gift = await load('lib/gifts/helpers.js',{'@/lib/supabase/admin':{getAdminClient:()=>port},'@/lib/commerce/entitlements':commerce,
    '@/lib/commerce/resolve-storefront-product':resolver,
    '@/lib/auth/session-user':{getFanSessionUser:async()=>null},'@/lib/guest-session':{normalizeEmail:s=>String(s||'').trim().toLowerCase()},
    '@/lib/gifts/token-hash':{hashGiftLinkToken:s=>crypto.createHash('sha256').update(s).digest('hex')},
    '@/lib/gifts/reminder-link':{isGiftReminderToken:()=>false,parseGiftReminderToken:()=>null},
    '@/lib/entitlements':flags,
    '@/lib/server/account-state-cache':{invalidateAccountStateCache:async()=>{}}},{'@/lib/commerce/ownership-proof':proof});
  const service = await load('lib/commerce/ownership-recovery.js',{'node:crypto':{default:crypto},'@/lib/commerce/ownership-proof':proof,
    '@/lib/commerce/ownership-transaction':transaction,'@/lib/commerce/entitlements':commerce,'@/lib/gifts/helpers':gift,'@/lib/server/account-state-cache':{invalidateAccountStateCache:async()=>{}}});
  return { service: service.namespace, proof:proof.namespace, commerce:commerce.namespace, gift:gift.namespace, transaction:transaction.namespace, load, context };
}
async function fixture() {
  const db = new PGlite();
  try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create table profiles(id uuid primary key,email text);
    create table products(id uuid primary key,slug text unique,title text,product_type text);
    create table releases(id uuid primary key,slug text,title text,release_type text,cover_art_r2_key text);
    create table gifts(id uuid primary key,item_id uuid,item_type text,item_title text,recipient_email text,recipient_id uuid,sender_id uuid,status text,claimed boolean,expires_at timestamptz,claimed_at timestamptz,updated_at timestamptz);
    create table purchases(id uuid primary key default gen_random_uuid(),user_id uuid,status text,amount_cents int,gift_id uuid,gifted_by uuid,purchase_type text,items jsonb);
    create table library_items(id uuid primary key default gen_random_uuid(),user_id uuid,product_id uuid,purchase_id uuid,source text,gifted_by uuid,unique(user_id,product_id));
    create table entitlements(id uuid primary key default gen_random_uuid(),user_id uuid,resource_type text,resource_id uuid,source_type text,source_id uuid,status text,starts_at timestamptz default now(),ends_at timestamptz,metadata jsonb,updated_at timestamptz);
    create table user_entitlements(user_id uuid primary key,vault_access boolean default false,subscriber boolean default false,collector_card boolean default false,vault_source text,metadata jsonb,updated_at timestamptz);
    create table signals(id uuid primary key default gen_random_uuid(),title text,type text,status text,priority int,metadata jsonb);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261023000000_ownership_email_handoff.sql',import.meta.url),'utf8'));
  const actor={id:id(),email:'buyer@example.invalid'}, donor=id(), other={id:id(),email:'other@example.invalid'}, product=id(), purchase=id(), gift=id();
  await db.query('insert into auth.users values ($1,$2),($3,$4),($5,$6)',[actor.id,actor.email,donor,'old@guest.2mrrw.local',other.id,other.email]);
  await db.query('insert into profiles values ($1,$2)',[donor,actor.email]);
  await db.query("insert into products values ($1,'fixture-album','Fixture','album')",[product]);
  await db.query("insert into purchases(id,user_id,status) values ($1,$2,'completed')",[purchase,donor]);
  await db.query("insert into library_items(user_id,product_id,purchase_id,source) values ($1,$2,$3,'purchase')",[donor,product,purchase]);
  await db.query("insert into gifts(id,item_id,item_type,item_title,recipient_email,recipient_id,sender_id,status,claimed,expires_at) values ($1,$2,'album','Fixture',$3,$4,$5,'pending',false,$6)",[gift,product,actor.email,donor,other.id,new Date(instant+86400000).toISOString()]);
  // Current catalog queries also preserve the deployed soft-deletion columns.
  await db.exec('alter table products add column deleted_at timestamptz;alter table releases add column deleted_at timestamptz');
  const m=await modules(db);let email,clock=instant;
  const service=m.service.createOwnershipRecovery({transaction:run=>db.transaction(run),admin:m.transaction.transactionAdmin(db),sendEmail:async request=>{email=request;return {sent:true};},now:()=>clock});
  const start=async(purpose='recover_library')=>service.start({actor,purpose,gift:purpose==='claim_gift'?{id:gift}:null});
  const complete=(c,extra={})=>service.complete({actor,challengeId:c.challengeId,handle:c.handle,purpose:c.purpose,code:email.text.match(/\b\d{8}\b/)[0],...extra});
  const snapshot=async()=>JSON.stringify((await db.query(`select jsonb_build_object('purchases',(select jsonb_agg(p order by id) from purchases p),'library',(select jsonb_agg(l order by id) from library_items l),'entitlements',(select jsonb_agg(e order by id) from entitlements e),'gifts',(select jsonb_agg(g order by id) from gifts g),'flags',(select jsonb_agg(f order by user_id) from user_entitlements f)) as state`)).rows[0].state);
  return {db,m,actor,other,donor,product,purchase,gift,service,start,complete,snapshot,email:()=>email,tick:ms=>{clock+=ms;}};
  } catch (error) { await db.close(); throw error; }
}
async function run(fn){const f=await fixture();try{await fn(f);}finally{await f.db.close();}}
async function unchanged(f,fn){const before=await f.snapshot();await fn();assert.equal(await f.snapshot(),before,'No purchase/library/entitlement/gift ownership writes');}

test('Migration executes; anonymous and authenticated clients cannot read or mutate challenge rows',()=>run(async f=>{
 for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);try{await assert.rejects(f.db.query('select * from ownership_email_challenges'),{code:'42501'});await assert.rejects(f.db.query("delete from ownership_email_challenges"),{code:'42501'});}finally{await f.db.exec('reset role');}}
 await f.db.exec('grant select on ownership_email_challenges to authenticated;set role authenticated');try{assert.equal((await f.db.query('select * from ownership_email_challenges')).rows.length,0);}finally{await f.db.exec('reset role');}
}));
test('Fresh email proof recovers legacy guest purchase atomically; no plaintext code stored; lost response/replay creates no further rights',()=>run(async f=>{
 const c=await f.start();assert.equal(c.state,'code_sent');assert.ok(!f.email().subject.includes(f.email().text.match(/\b\d{8}\b/)[0]));
 const challenge=(await f.db.query('select * from ownership_email_challenges')).rows[0];assert.ok(!JSON.stringify(challenge).includes(c.handle));assert.ok(!JSON.stringify(challenge).includes(f.email().text.match(/\b\d{8}\b/)[0]));
 assert.equal((await f.complete(c)).state,'completed');
 assert.equal((await f.db.query('select count(*)::int n from library_items where user_id=$1',[f.actor.id])).rows[0].n,1);
 assert.equal((await f.db.query('select count(*)::int n from entitlements where user_id=$1',[f.actor.id])).rows[0].n,1);
 assert.equal((await f.db.query('select user_id from purchases where id=$1',[f.purchase])).rows[0].user_id,f.donor);
 assert.equal((await f.db.query('select state from ownership_email_challenges')).rows[0].state,'consumed');
 await unchanged(f,()=>assert.rejects(f.complete(c),{code:'challenge_unavailable'}));
}));
for(const [name,patch] of [ ['SMS/login code',{code:'00000000'}],['wrong purpose',{purpose:'claim_gift'}],['other account',{actor:{}}],['forged handle',{handle:'a'.repeat(64)}],['forged challenge ID',{challengeId:crypto.randomUUID()}] ]) test(name+' cannot write ownership',()=>run(async f=>{const c=await f.start();await unchanged(f,()=>assert.rejects(f.complete(c,patch)));}));
test('Changed canonical email and expired proof cannot write ownership',()=>run(async f=>{
 const c=await f.start();await f.db.query('update auth.users set email=$2 where id=$1',[f.actor.id,'changed@example.invalid']);await unchanged(f,()=>assert.rejects(f.complete(c),{code:'identity_changed'}));
 await f.db.query('update auth.users set email=$2 where id=$1',[f.actor.id,f.actor.email]);f.tick(300001);await unchanged(f,()=>assert.rejects(f.complete(c),{code:'challenge_unavailable'}));
}));
test('Attempts are atomic; five invalid codes lock challenge and correct code cannot revive it',()=>run(async f=>{
 const c=await f.start();await unchanged(f,async()=>{for(let i=0;i<5;i++) await assert.rejects(f.complete(c,{code:'bad'}),{code:'invalid_code'});await assert.rejects(f.complete(c),{code:'challenge_unavailable'});});
 assert.equal((await f.db.query('select attempts from ownership_email_challenges')).rows[0].attempts,5);
}));
test('Parallel consumption commits once in isolated PostgreSQL; replay cannot duplicate rights',()=>run(async f=>{
 const c=await f.start();const results=await Promise.allSettled([f.complete(c),f.complete(c)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.db.query('select count(*)::int n from entitlements')).rows[0].n,1);
}));
test('Entitlement write failure rolls back library write and proof consumption; retry recovers',()=>run(async f=>{
 const c=await f.start();await f.db.exec("alter table entitlements add constraint fail_test check (false) not valid");await unchanged(f,()=>assert.rejects(f.complete(c)));assert.equal((await f.db.query('select state from ownership_email_challenges')).rows[0].state,'delivered');await f.db.exec('alter table entitlements drop constraint fail_test');assert.equal((await f.complete(c)).state,'completed');
}));
test('Purchase refund or changed targets after proof issuance cannot write ownership',()=>run(async f=>{
 const c=await f.start();await f.db.query("update purchases set status='refunded' where id=$1",[f.purchase]);await unchanged(f,()=>assert.rejects(f.complete(c),{code:'ownership_targets_changed'}));
}));
test('Finite source entitlement retains exact expiry; revoked source is never recovered',()=>run(async f=>{
 const end=new Date(instant+60000).toISOString();await f.db.query("insert into entitlements(user_id,resource_type,resource_id,source_type,source_id,status,starts_at,ends_at) values ($1,'product',$2,'purchase',$3,'active',$4,$5)",[f.donor,f.product,f.purchase,new Date(instant-1000).toISOString(),end]);
 const c=await f.start();await f.complete(c);assert.equal(new Date((await f.db.query('select ends_at from entitlements where user_id=$1',[f.actor.id])).rows[0].ends_at).toISOString(),end);
}));
test('Gift-specific email proof grants only that gift; same-principal repair is idempotent; it cannot authorize global guest recovery',()=>run(async f=>{
 const c=await f.start('claim_gift');await f.complete(c);
 const ownedBefore=(await f.db.query('select id,user_id,product_id,purchase_id from library_items order by id')).rows;const row=(await f.db.query('select * from gifts')).rows[0];await f.m.gift.claimGiftForUser(row,f.actor);assert.deepEqual((await f.db.query('select id,user_id,product_id,purchase_id from library_items order by id')).rows,ownedBefore);assert.equal((await f.db.query('select count(*)::int n from entitlements')).rows[0].n,1);
 await unchanged(f,()=>assert.rejects(f.complete(c,{purpose:'recover_library'})));
 assert.equal((await f.db.query('select count(*)::int n from purchases where user_id=$1',[f.actor.id])).rows[0].n,1);
}));
test('Wrong recipient and gift sender cannot obtain ownership proof for a different gift recipient',()=>run(async f=>{
 await unchanged(f,()=>assert.rejects(f.service.start({actor:f.other,purpose:'claim_gift',gift:{id:f.gift}}),{code:'email_mismatch'}));
}));
test('Unverified claim and forged JSON capability are rejected at actual shared writers',()=>run(async f=>{
 const gift=(await f.db.query('select * from gifts')).rows[0];await unchanged(f,async()=>{
 await assert.rejects(f.m.gift.claimGiftForUser(gift,f.actor),{code:'email_verification_required'});
 await assert.rejects(f.m.commerce.grantLibraryItems({userId:f.actor.id,purchaseId:f.purchase,slugs:['fixture-album'],authority:{userId:f.actor.id,targets:['purchase:'+f.purchase]}}),{code:'email_verification_required'});
 });
}));
test('Email delivery failure, duplicate starts, donor conversion and service outage fail closed',()=>run(async f=>{
 const failed=f.m.service.createOwnershipRecovery({transaction:run=>f.db.transaction(run),admin:f.m.transaction.transactionAdmin(f.db),sendEmail:async()=>({sent:false}),now:()=>instant});
 await unchanged(f,()=>assert.rejects(failed.start({actor:f.actor,purpose:'recover_library'}),{code:'email_delivery_unavailable'}));
 const c=await f.start();const newer=await f.start();await unchanged(f,()=>assert.rejects(f.complete(c),{code:'challenge_unavailable'}));
 await unchanged(f,()=>assert.rejects(f.start(),{code:'verification_rate_limited'}));
 await f.db.query('update auth.users set email=$2 where id=$1',[f.donor,'registered@example.invalid']);await unchanged(f,()=>assert.rejects(f.complete(newer),{code:'ownership_targets_changed'}));
}));

test('Cancellation and scoped server capabilities cannot be replayed, broadened or used for another account/purpose',()=>run(async f=>{
 const c=await f.start();await unchanged(f,async()=>{await f.service.cancel({actor:f.actor,challengeId:c.challengeId,purpose:c.purpose,handle:c.handle});await assert.rejects(f.complete(c),{code:'challenge_unavailable'});});
 let retained;
 await f.m.proof.withOwnershipProof({userId:f.actor.id,email:f.actor.email,purpose:'claim_gift',targets:['gift:'+f.gift],expiresAt:Date.now()+60000}, async authority=>{retained=authority;for(const options of [{userId:f.actor.id,target:'purchase:'+f.purchase,purpose:'recover_library'},{userId:f.other.id,target:'gift:'+f.gift,purpose:'claim_gift'},{userId:f.actor.id,target:'gift:'+crypto.randomUUID(),purpose:'claim_gift'}])assert.throws(()=>f.m.proof.requireOwnershipProof(authority,options),{code:'email_verification_required'});});
 assert.throws(()=>f.m.proof.requireOwnershipProof(retained,{userId:f.actor.id,target:'gift:'+f.gift,purpose:'claim_gift'}),{code:'email_verification_required'});
}));
for(const status of ['revoked','expired','future','registered-donor','ambiguous'])test(status+' source cannot mint new permanent ownership',()=>run(async f=>{
 if(status==='registered-donor')await f.db.query('update auth.users set email=$2 where id=$1',[f.donor,'registered@example.invalid']);
 else if(status==='ambiguous') { /* Add a second provenance below. */ }
 else await f.db.query("insert into entitlements(user_id,resource_type,resource_id,source_type,source_id,status,starts_at,ends_at) values ($1,'product',$2,'purchase',$3,$4,$5,$6)",[f.donor,f.product,f.purchase,status==='revoked'?'revoked':'active',new Date(instant+(status==='future'?60000:-60000)).toISOString(),status==='expired'?new Date(instant-1000).toISOString():null]);
 if(status==='ambiguous') { const newDonor=crypto.randomUUID(),newPurchase=crypto.randomUUID();await f.db.query('insert into auth.users values ($1,$2)',[newDonor,'another@guest.2mrrw.local']);await f.db.query('insert into profiles values ($1,$2)',[newDonor,f.actor.email]);await f.db.query("insert into purchases(id,user_id,status) values ($1,$2,'completed')",[newPurchase,newDonor]);await f.db.query("insert into library_items(user_id,product_id,purchase_id,source) values ($1,$2,$3,'purchase')",[newDonor,f.product,newPurchase]);await unchanged(f,()=>assert.rejects(f.start(),{code:'ambiguous_recovery_requires_review'})); }
 else await unchanged(f,async()=>assert.equal((await f.start()).state,'nothing_to_recover'));
}));

test('Vault gift flag uses the same transaction and rolls back with the purchase and proof on failure',()=>run(async f=>{
 await f.db.query("update products set slug='vault-pass' where id=$1",[f.product]);await f.db.query("update gifts set item_type='vault_access' where id=$1",[f.gift]);const c=await f.start('claim_gift');
 await f.db.exec('alter table user_entitlements add constraint fail_test check (false) not valid');await unchanged(f,()=>assert.rejects(f.complete(c)));assert.equal((await f.db.query('select state from ownership_email_challenges')).rows[0].state,'delivered');
 await f.db.exec('alter table user_entitlements drop constraint fail_test');await f.complete(c);assert.equal((await f.db.query('select vault_access from user_entitlements where user_id=$1',[f.actor.id])).rows[0].vault_access,true);
}));

test('Actual API requires Origin/JSON/session, keeps handle HttpOnly and never accepts a request email as recovery authority',()=>run(async f=>{
 const cookies=new Map();let options,lookupError=null;
 const next={json:(body,opts={})=>({body,status:opts.status||200,headers:opts.headers,cookies:{set:(key,value,o)=>{cookies.set(key,value);options=o;}}})};
 const route=await f.m.load('app/api/account/ownership/route.js',{'next/server':{NextResponse:next},'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:f.actor},error:lookupError})}})},'@/lib/supabase/admin':{getAdminClient:()=>({})},'@/lib/gifts/helpers':{getGiftByToken:async()=>null},'@/lib/commerce/ownership-recovery':{createOwnershipRecovery:()=>f.service},'@/lib/commerce/ownership-transaction':{ownershipTransaction:()=>{throw Error('Route must use fixture factory');}},'@/lib/server/email':{sendTransactionalEmail:()=>{throw Error('No network');}}});
 const request=(body,origin='https://fixture.invalid')=>({url:'https://fixture.invalid/api/account/ownership',headers:new Headers({'origin':origin,'content-type':'application/json'}),text:async()=>JSON.stringify(body),cookies:{get:key=>({value:cookies.get(key)})}});
 await unchanged(f,async()=>assert.equal((await route.namespace.POST(request({action:'start',purpose:'recover_library'},'https://attacker.invalid'))).status,403));
 lookupError={status:503};await unchanged(f,async()=>assert.equal((await route.namespace.POST(request({action:'start',purpose:'recover_library'}))).status,503));lookupError=null;
 const started=await route.namespace.POST(request({action:'start',purpose:'recover_library',email:'victim@example.invalid',userId:f.other.id}));assert.equal(started.status,200);assert.ok(!('handle' in started.body));assert.equal(options.httpOnly,true);assert.equal(options.sameSite,'strict');assert.equal(f.email().to,f.actor.email);
 await unchanged(f,async()=>assert.equal((await route.namespace.POST(request({action:'verify',purpose:'claim_gift',challengeId:started.body.challengeId,code:f.email().text.match(/\b\d{8}\b/)[0]}))).status,403));
 const done=await route.namespace.POST(request({action:'verify',purpose:'recover_library',challengeId:started.body.challengeId,code:f.email().text.match(/\b\d{8}\b/)[0]}));assert.equal(done.status,200);assert.equal(done.body.state,'completed');assert.equal(options.maxAge,0);
}));

test('Gift sender cannot recover unrelated guest purchases and forged purchase/product proof cannot reach the writer',()=>run(async f=>{
 await unchanged(f,async()=>assert.equal((await f.service.start({actor:f.other,purpose:'recover_library'})).state,'nothing_to_recover'));
 await f.m.proof.withOwnershipProof({userId:f.actor.id,email:f.actor.email,purpose:'recover_library',targets:['purchase:'+f.purchase,'product:another-product'],expiresAt:Date.now()+60000},async authority=>{
   await unchanged(f,()=>assert.rejects(f.m.commerce.grantLibraryItems({userId:f.actor.id,purchaseId:f.purchase,slugs:['fixture-album'],authority,admin:f.m.transaction.transactionAdmin(f.db)}),{code:'email_verification_required'}));
 });
}));

test('Release-backed gift reuses the existing catalog resolver and commits the intended product',()=>run(async f=>{
 const release=crypto.randomUUID();await f.db.query("insert into releases(id,slug,title,release_type) values ($1,'fixture-album','Fixture','album')",[release]);await f.db.query('update gifts set item_id=$2 where id=$1',[f.gift,release]);const c=await f.start('claim_gift');await f.complete(c);assert.equal((await f.db.query('select product_id from library_items where user_id=$1',[f.actor.id])).rows[0].product_id,f.product);
}));
test('Dormant legacy gift completion cannot bypass the shared grant boundary',()=>run(async f=>{
 await f.db.exec('create table gift_transactions(id uuid primary key,product_id uuid,status text)');const transactionId=crypto.randomUUID();await f.db.query("insert into gift_transactions values ($1,$2,'pending')",[transactionId,f.product]);
 const admin={from(table){assert.equal(table,'gift_transactions');let lookup;return {select(){return this;},eq(key,value){assert.equal(key,'id');lookup=value;return this;},async maybeSingle(){return {data:(await f.db.query("select t.*,json_build_object('slug',p.slug) as products from gift_transactions t join products p on p.id=t.product_id where t.id=$1",[lookup])).rows[0],error:null};}};}};
 const legacyGiftModule=await f.m.load('lib/commerce/gift-transactions.js',{'crypto':{default:crypto},'@/lib/supabase/admin':{getAdminClient:()=>admin},'@/lib/commerce/entitlements':{grantLibraryItems:f.m.commerce.grantLibraryItems,isMissingSupabaseColumn:()=>false}});
 await unchanged(f,()=>assert.rejects(legacyGiftModule.namespace.completeGiftTransaction({transactionId,recipientUserId:f.other.id,redeemTokenRaw:'synthetic-link'}),{code:'email_verification_required'}));
 assert.equal((await f.db.query('select status from gift_transactions')).rows[0].status,'pending');
}));
for(const change of ['revoked','item_type'])test('Gift '+change+' change after issuance rejects proof without any ownership or Vault write',()=>run(async f=>{
 const c=await f.start('claim_gift');if(change==='revoked')await f.db.query("update gifts set status='revoked' where id=$1",[f.gift]);else await f.db.query("update gifts set item_type='vault_access' where id=$1",[f.gift]);await unchanged(f,()=>assert.rejects(f.complete(c)));
}));
test('Incomplete same-principal legacy gift requires fresh proof; verification repairs without duplicating its purchase',()=>run(async f=>{
 await f.db.query("update gifts set status='claimed',claimed=true,recipient_id=$2 where id=$1",[f.gift,f.actor.id]);
 await f.db.query("insert into purchases(user_id,status,gift_id,amount_cents,purchase_type) values ($1,'completed',$2,0,'gift')",[f.actor.id,f.gift]);const gift=(await f.db.query('select * from gifts')).rows[0];
 await unchanged(f,()=>assert.rejects(f.m.gift.claimGiftForUser(gift,f.actor),{code:'email_verification_required'}));const c=await f.start('claim_gift');await f.complete(c);
 assert.equal((await f.db.query('select count(*)::int n from purchases where gift_id=$1 and user_id=$2',[f.gift,f.actor.id])).rows[0].n,1);assert.equal((await f.db.query('select count(*)::int n from library_items where user_id=$1',[f.actor.id])).rows[0].n,1);
}));

test('Sensitive email delivery redacts echoed OTP/handle data and provider exceptions from logs and results',()=>run(async f=>{
 const records=[];f.m.context.console={error:(...args)=>records.push(args),info:(...args)=>records.push(args)};f.m.context.process.env.RESEND_API_KEY='synthetic-fixture-key';
 const sensitive='fixture-sensitive-OTP-and-handle';f.m.context.fetch=async()=>({ok:false,status:400,text:async()=>sensitive});const sender=await f.m.load('lib/server/email.js');
 const result=await sender.namespace.sendTransactionalEmail({to:f.actor.email,subject:'Ownership verification',text:sensitive,html:sensitive,sensitive:true});assert.equal(result.sent,false);assert.ok(!JSON.stringify(result).includes(sensitive));assert.ok(!JSON.stringify(records).includes(sensitive));
 f.m.context.fetch=async()=>{throw Error(sensitive);};await sender.namespace.sendTransactionalEmail({to:f.actor.email,subject:sensitive,text:sensitive,sensitive:true});assert.ok(!JSON.stringify(records).includes(sensitive));
}));

test('Ambiguous duplicate gift purchase provenance fails closed at the transaction data boundary',()=>run(async f=>{
 await f.db.query("insert into purchases(user_id,status,gift_id) values ($1,'completed',$2),($1,'completed',$2)",[f.actor.id,f.gift]);const c=await f.start('claim_gift');await unchanged(f,()=>assert.rejects(f.complete(c),{code:'PGRST116'}));assert.equal((await f.db.query('select state from ownership_email_challenges')).rows[0].state,'delivered');
}));

test('Retired purchase writer stays denied even when its legacy switch is enabled before any ownership access',()=>run(async f=>{
 f.m.context.process.env.LEGACY_SEED_ROUTES_ENABLED='1';const next={NextResponse:Response};const retired=await f.m.load('lib/auth/retired-route.js',{'next/server':next});let accesses=0;
 const route=await f.m.load('app/api/save-purchase/route.js',{'next/server':next,'@/lib/auth/retired-route':retired,'@/lib/supabase/admin':{getAdminClient:()=>{accesses++;throw Error('No ownership access permitted');}}});
 await unchanged(f,async()=>{const response=await route.namespace.POST({json:async()=>({userId:f.other.id,items:[{slug:'fixture-album'}],isAdmin:true})});assert.equal(response.status,410);assert.equal(accesses,0);});
 delete f.m.context.process.env.LEGACY_SEED_ROUTES_ENABLED;await unchanged(f,async()=>assert.equal((await route.namespace.POST({json:async()=>({})})).status,410));
}));
test('Existing gift creation records only the scoped gift and does not grant unrelated ownership to its sender or cached recipient',()=>run(async f=>{
 await f.db.exec("alter table gifts alter column id set default gen_random_uuid(),alter column status set default 'pending',alter column claimed set default false,add column recipient_phone text,add column message text,add column gift_link_token_hash text,add column gift_link_token text");
 const port=f.m.transaction.transactionAdmin(f.db);const admin={from(table){if(table!=='profiles')return port.from(table);let email;return {select(){return this;},ilike(_key,value){email=value;return this;},async order(){return {data:(await f.db.query('select * from profiles where lower(email)=$1',[email])).rows,error:null};}};}};
 const resolver=await f.m.load('lib/commerce/resolve-storefront-product.js',{'@/lib/commerce/catalog':{getProductCatalog:()=>[]}});
 const tokens=await f.m.load('lib/gifts/token-hash.js',{'crypto':{default:crypto}});
 const constants=await f.m.load('lib/auth/constants.js');
 const sender=await f.m.load('lib/gifts/send-gift.js',{'@/lib/supabase/admin':{getAdminClient:()=>admin},'@/lib/commerce/resolve-storefront-product':resolver,'@/lib/auth/constants':constants,'@/lib/gifts/email':{buildGiftLink:token=>'https://fixture.invalid/gift/'+token,sendGiftEmail:async()=>({sent:true})},'@/lib/gifts/token-hash':tokens,'@/lib/server/twilio':{sendSMS:()=>{throw Error('No SMS send expected');}}});
 await unchanged(f,()=>assert.rejects(sender.namespace.sendStorefrontGift({senderUser:{id:f.other.id,isAdmin:false},releaseSlug:'fixture-album',recipientEmail:f.actor.email}),{code:'ADMIN_REQUIRED'}));
 const result=await sender.namespace.sendStorefrontGift({senderUser:{id:f.other.id,isAdmin:true,isGuest:false},releaseSlug:'fixture-album',recipientEmail:f.actor.email});assert.equal(result.emailSent,true);assert.equal(result.gift.recipient_email,f.actor.email);assert.equal(result.gift.claimed,false);assert.equal(result.gift.recipient_id,f.donor);
 assert.equal((await f.db.query('select count(*)::int n from library_items where user_id=$1 or user_id=$2',[f.other.id,f.actor.id])).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from entitlements')).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from purchases where user_id=$1 or user_id=$2',[f.other.id,f.actor.id])).rows[0].n,0);
}));

test('Legacy claimed gift signup establishes the account only and cannot mint ownership without email proof',()=>run(async f=>{
 const createdId=crypto.randomUUID();let creations=0;const route=await f.m.load('app/api/gifts/claim-signup/route.js',{
 'next/server':{NextResponse:Response},'@/lib/supabase/admin':{getAdminClient:()=>({auth:{admin:{createUser:async input=>{creations++;await f.db.query('insert into auth.users values ($1,$2)',[createdId,input.email]);return {data:{user:{id:createdId,email:input.email}},error:null};}}}})},
 '@/lib/supabase/server':{createClient:async()=>({auth:{signInWithPassword:async()=>({data:{session:{fixture:true}},error:null})}})},
 '@/lib/gifts/helpers':{getGiftByToken:async()=>({id:f.gift,status:'claimed',recipient_email:'new-legacy@example.invalid'}),giftPublicState:g=>({state:g.status}),expireGiftIfNeeded:async g=>g},
 '@/lib/server/rate-limit':{checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>{throw Error('Unexpected limit');}},'@/lib/gifts/token-hash':{hashGiftLinkToken:()=> 'synthetic-hash'},
 '@/lib/auth/validation':{validateEmail:value=>({ok:true,value})},'@/lib/auth/provision-new-user':{persistNewUserProfileOrRollback:async()=>({ok:true})},
 '@/lib/server/email':{buildWelcomeEmail:()=>({}),sendTransactionalEmail:async()=>({sent:true})},'@/lib/geo/geocode-profile':{geocodeProfileIfNeeded:async()=>{}},'@/lib/auth/attribution-cookie':{readAttributionCookie:async()=>null}});
 await unchanged(f,async()=>{const response=await route.namespace.POST({headers:new Headers(),json:async()=>({email:'new-legacy@example.invalid',password:'synthetic-fixture-password',country:'Canada',giftToken:'synthetic-gift-link'})});assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.verificationRequired,true);assert.equal(payload.gift,null);assert.equal(creations,1);});
}));

// Production schema was inspected read-only before rollout: gift_id belongs to
// purchases and entitlement metadata; library_items has purchase_id/gifted_by.
test('Production library schema preserves exact gift provenance without a library gift_id column',()=>run(async f=>{
 const c=await f.start('claim_gift');await f.complete(c);
 const columns=(await f.db.query("select column_name from information_schema.columns where table_name='library_items'")).rows;
 assert.ok(!columns.some(c=>c.column_name==='gift_id'));
 const {rows}=await f.db.query(`select li.purchase_id,li.gifted_by,li.source,p.gift_id,e.metadata->>'gift_id' as entitlement_gift
   from library_items li join purchases p on p.id=li.purchase_id
   join entitlements e on e.source_id=p.id and e.user_id=li.user_id and e.resource_id=li.product_id
   where li.user_id=$1 and li.product_id=$2`,[f.actor.id,f.product]);
 assert.equal(rows.length,1);assert.equal(rows[0].gift_id,f.gift);assert.equal(rows[0].entitlement_gift,f.gift);
 assert.equal(rows[0].gifted_by,f.other.id);assert.equal(rows[0].source,'gift');
}));

test('Production connection keeps CA and hostname verification enabled',async()=>{
 const db=new PGlite();
 try {
  const m=await modules(db);const ca=await m.load('lib/supabase/database-ca.js');
  const cert=new crypto.X509Certificate(ca.namespace.SUPABASE_DATABASE_CA);
  assert.equal(cert.ca,true);assert.equal(cert.fingerprint256.replaceAll(':',''),'807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA');
  m.context.process.env.POSTGRES_URL='postgres://postgres.fixture:synthetic@aws-0-fixture.pooler.supabase.com:6543/postgres';
  let options;const adapter=await m.load('lib/commerce/ownership-transaction.js',{'server-only':{},'@/lib/supabase/database-ca':ca,
    '@/lib/supabase/supabase-url':{SUPABASE_URL:'https://fixture.supabase.co'},
    postgres:{default:(_url,value)=>{options=value;return {begin:async run=>run({unsafe:async()=>[]})};}}});
  await adapter.namespace.ownershipTransaction(async()=>{});
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.ssl.ca,ca.namespace.SUPABASE_DATABASE_CA);
  assert.equal(options.ssl.checkServerIdentity,undefined,'Node default hostname verification is retained');
 } finally {await db.close();}
});
