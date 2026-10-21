import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {createCreditDatabaseFixture}=await import('./credits-postgres-fixture.mjs');
const db=await createCreditDatabaseFixture();
const r='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222',t='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',r2='55555555-5555-4555-8555-555555555555',t2='66666666-6666-4666-8666-666666666666';
const personA='77777777-7777-4777-8777-777777777777',personB='88888888-8888-4888-8888-888888888888';
await db.query(`INSERT INTO releases(id,title,slug,status,release_type,updated_at,metadata) VALUES($1,'Album','album','published','album',clock_timestamp(),'{}'),($2,'Other','other','published','single',clock_timestamp(),'{}')`,[r,r2]);
await db.query(`INSERT INTO products(id,release_id,slug,title,product_type,release_type,price_cents,credits,metadata,updated_at) VALUES($1,$2,'album','Album','album','albums',999,'{"written_by":["Legacy Writer"],"mixing_engineer":"Engineer","unknown":{"keep":true}}','{"genre":"R&B","artist":{"name":"Artist","artist_id":"preserve"},"unrelated":42}',clock_timestamp())`,[p,r]);
await db.query(`INSERT INTO tracks(id,release_id,title,position,updated_at) VALUES($1,$2,'Track',1,clock_timestamp()),($3,$4,'Foreign',1,clock_timestamp())`,[t,r,t2,r2]);
await db.query(`INSERT INTO catalog_tracks(id,track_id,product_id,album_slug,slug,title,track_number,position,credits,metadata,updated_at) VALUES($1,$2,$3,'album','track','Track',1,1,'{"produced_by":["Legacy Producer"],"mastering_engineer":"Track Engineer"}','{}',clock_timestamp())`,[c,t,p]);
await db.query(`INSERT INTO collaborators(id,name) VALUES($1,'Same Name'),($2,'Same Name')`,[personA,personB]);
const first=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const revision=async(ref=r) => (await first('SELECT _credit_revision($1) AS value',[ref])).value;
const edit=async(patch,rev,ref=r) => (await first('SELECT commit_release_credit_edit($1,$2::jsonb,$3::jsonb) AS value',[ref,JSON.stringify(rev||await revision(ref)),JSON.stringify(patch)])).value;
let checks=0;const run=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const group=(entries,state='legacy')=>({state,entries});const entry=(name,percentage='',contributor_id)=>({name,percentage,...(contributor_id?{contributor_id}:{})});
await run('migration installs on the captured live schema without tracks.slug or a preexisting editing RPC',async()=>assert.equal((await first('SELECT credit_storage_capabilities() AS c')).c.version,1));
await run('published metadata and UPC persist without changing extended credits or artist identity',async()=>{
 await edit({title:'Updated Album',artist:'Corrected Artist',upc:'001234567890'});
 const row=await first('SELECT title,metadata,credits FROM products WHERE id=$1',[p]);assert.equal(row.title,'Updated Album');assert.equal(row.metadata.artist.artist_id,'preserve');assert.equal(row.metadata.artist.name,'Corrected Artist');assert.equal(row.credits.mixing_engineer,'Engineer');assert.equal(row.credits.unknown.keep,true);assert.equal((await first('SELECT upc FROM releases WHERE id=$1',[r])).upc,'001234567890');
});
await run('the returned edit revision supports another save without reloading',async()=>{
 const saved=await edit({genre:'Soul'});assert.deepEqual(saved.revision,await revision());
 await edit({genre:'R&B'},saved.revision);
});
await run('same-name UUIDs and exact 70/30 allocation persist privately',async()=>{
 await edit({credit_groups:{songwriter:group([entry('Same Name','70.00',personA),entry('Same Name','30.00',personB)],'complete')}});
 const rows=(await db.query('SELECT display_name,contributor_id,percentage_hundredths FROM credit_assignments ORDER BY position')).rows;assert.deepEqual(rows.map(e=>e.percentage_hundredths),[7000,3000]);assert.equal(rows[1].contributor_id,personB);
 const projection=(await first('SELECT credits FROM products WHERE id=$1',[p])).credits;assert.equal(JSON.stringify(projection).includes('percentage'),false);assert.equal(projection.mixing_engineer,'Engineer');
});
await run('invalid completed totals roll back every related write',async()=>{
 const before=await revision();await assert.rejects(()=>edit({title:'Must Roll Back',credit_groups:{songwriter:group([entry('Writer','99.99')],'complete')}}),e=>e.code==='22023');
 assert.equal((await first('SELECT title FROM products WHERE id=$1',[p])).title,'Updated Album');assert.deepEqual(await revision(),before);
});
await run('decimal 33.33/33.33/33.34 is exactly complete',async()=>{
 await edit({credit_groups:{producer:group([entry('A','33.33'),entry('B','33.33'),entry('C','33.34')],'complete')}});
 assert.equal((await first("SELECT sum(a.percentage_hundredths)::int AS total FROM credit_assignments a JOIN credit_groups g ON g.id=a.group_id WHERE g.category='producer'")).total,10000);
});
await run('negative, malformed, nonfinite and excess-precision values fail server validation',async()=>{
 for(const percentage of ['-1','NaN','Infinity','1e2','100.01','1.001'])await assert.rejects(()=>edit({credit_groups:{songwriter:group([entry('Writer',percentage)],'draft')}}),e=>e.code==='22023');
});
await run('foreign recording updates roll back earlier release edits',async()=>{
 await assert.rejects(()=>edit({title:'Must Also Roll Back',recordings:[{id:t2,isrc:'WRONG'}]}),e=>e.code==='22023');assert.equal((await first('SELECT title FROM products WHERE id=$1',[p])).title,'Updated Album');
});
await run('recording overrides, featured artists and ISRC preserve release scope',async()=>{
 await edit({recordings:[{id:t,isrc:'USABC2600001',inherit_credits:false,credit_groups:{songwriter:group([entry('Track Writer')]),featured_artist:group([entry('Track Guest')])}}]});
 const track=await first('SELECT isrc,written_by,featured_artists FROM tracks WHERE id=$1',[t]);assert.equal(track.isrc,'USABC2600001');assert.deepEqual(track.written_by,['Track Writer']);assert.deepEqual(track.featured_artists,['Track Guest']);
 const product=(await first('SELECT credits FROM products WHERE id=$1',[p])).credits;assert.equal(product.written_by[0].contributor_id,personA);
 const recording=(await first('SELECT credits,metadata FROM catalog_tracks WHERE id=$1',[c]));assert.equal(recording.metadata.isrc,'USABC2600001');assert.equal(recording.credits.mastering_engineer,'Track Engineer');
});
await run('release edits do not replace explicit recording overrides',async()=>{
 await edit({credit_groups:{songwriter:group([entry('New Release Writer')])}});assert.deepEqual((await first('SELECT written_by FROM tracks WHERE id=$1',[t])).written_by,['Track Writer']);
});
await run('explicit inheritance follows release edits while retaining private override data',async()=>{
 await edit({recordings:[{id:t,inherit_credits:true}]});assert.deepEqual((await first('SELECT written_by FROM tracks WHERE id=$1',[t])).written_by,['New Release Writer']);
 await edit({credit_groups:{songwriter:group([entry('Inherited Writer')])}});assert.deepEqual((await first('SELECT written_by FROM tracks WHERE id=$1',[t])).written_by,['Inherited Writer']);
});
await run('omitted identifiers survive and explicit clears persist',async()=>{
 await edit({genre:'Soul'});assert.equal((await first('SELECT upc FROM releases WHERE id=$1',[r])).upc,'001234567890');
 await edit({upc:'',recordings:[{id:t,isrc:''}]});assert.equal((await first('SELECT upc FROM releases WHERE id=$1',[r])).upc,null);assert.equal((await first('SELECT isrc FROM tracks WHERE id=$1',[t])).isrc,null);
});
await run('stale revisions are rejected after a competing committed edit',async()=>{
 const old=await revision();await edit({genre:'Pop'},old);await assert.rejects(()=>edit({title:'Stale'},old),e=>e.code==='40001');
});
await run('directory identities are never renamed by a credit snapshot correction',async()=>{
 await edit({credit_groups:{songwriter:group([entry('Historical Name Correction','',personA)])}});assert.equal((await first('SELECT name FROM collaborators WHERE id=$1',[personA])).name,'Same Name');
});
await run('anonymous and ordinary authenticated roles cannot call the editing RPC or read private allocations',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);await assert.rejects(()=>db.query('SELECT * FROM public.credit_assignments'),e=>e.code==='42501');await assert.rejects(()=>db.query('SELECT public.credit_storage_capabilities()'),e=>e.code==='42501');await db.exec('RESET ROLE');
 }
});
await run('source-compatible migration is idempotent',async()=>{await db.exec(await fs.readFile('supabase/migrations/20261021010000_release_credit_contract.sql','utf8'));});
await run('atomic publication validates all targets and rolls back a failed final lifecycle transition',async()=>{
 await db.query("UPDATE tracks SET upload_status='ready',audio_r2_key='old.wav' WHERE id=$1",[t]);
 const before=await revision();
 const product=(await first('SELECT * FROM products WHERE id=$1',[p]));
 const payload={product:{...product,title:'Must Roll Back Again',credits:product.credits},recordings:[{id:t,audio_r2_key:'new.wav'}],catalog_tracks:[],release:{status:'scheduled',available_at:'2020-01-01'}};
 await assert.rejects(()=>db.query('SELECT commit_release_publication($1,$2::jsonb,$3::jsonb)',[r,JSON.stringify(before),JSON.stringify(payload)]),e=>e.code==='22023');
 assert.equal((await first('SELECT title FROM products WHERE id=$1',[p])).title,'Updated Album');assert.equal((await first('SELECT audio_r2_key FROM tracks WHERE id=$1',[t])).audio_r2_key,'old.wav');assert.deepEqual(await revision(),before);
});
await run('atomic publication preserves structured identities against old client credit defaults',async()=>{
 const product=(await first('SELECT * FROM products WHERE id=$1',[p]));
 const payload={product:{...product,credits:{written_by:[],mixing_engineer:'Engineer'}},recordings:[{id:t,audio_r2_key:'canonical.wav'}],catalog_tracks:[],release:{status:'published',slug:'album',title:'Updated Album',available_at:'2020-01-01'}};
 const response=(await first('SELECT commit_release_publication($1,$2::jsonb,$3::jsonb) AS value',[r,JSON.stringify(await revision()),JSON.stringify(payload)])).value;
 assert.equal(response.product_id,p);assert.equal((await first('SELECT credits FROM products WHERE id=$1',[p])).credits.written_by[0].contributor_id,personA);assert.equal((await first('SELECT audio_r2_key FROM tracks WHERE id=$1',[t])).audio_r2_key,'canonical.wav');
});
await run('draft snapshots reject stale writes and preserve incomplete form values',async()=>{
 await db.query("UPDATE releases SET status='draft' WHERE id=$1",[r2]);
 const data={data:{title:'Draft Title',credit_groups:{songwriter:group([entry('Draft Writer','20')],'draft')}},tracks:[]};
 const saved=(await first('SELECT save_release_credit_draft($1,NULL,$2::jsonb,2) AS value',[r2,JSON.stringify(data)])).value;
 await assert.rejects(()=>db.query('SELECT save_release_credit_draft($1,NULL,$2::jsonb,3)',[r2,JSON.stringify({data:{title:'Stale'}})]),e=>e.code==='40001');
 const next=(await first('SELECT save_release_credit_draft($1,$2,$3::jsonb,3) AS value',[r2,saved.saved_at,JSON.stringify({data:{genre:'R&B'}})])).value;
 const draft=await first('SELECT draft_payload FROM release_drafts WHERE release_id=$1',[r2]);assert.equal(draft.draft_payload.data.title,'Draft Title');assert.equal(draft.draft_payload.data.credit_groups.songwriter.entries[0].percentage,'20');assert.ok(next.saved_at);
});
console.log(`PostgreSQL engine fixture checks: ${checks} passed. This is not a production write or a browser/device test.`);
await db.close();
