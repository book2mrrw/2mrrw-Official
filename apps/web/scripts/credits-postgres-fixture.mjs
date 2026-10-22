import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function createCreditDatabaseFixture() {
const modulePath=process.env.CREDITS_PGLITE_MODULE || '/private/tmp/credits-postgres-fixture/node_modules/@electric-sql/pglite/dist/index.js';
const {PGlite}=await import(pathToFileURL(modulePath));
const db=new PGlite();
const schema=JSON.parse(await fs.readFile('docs/credits/frontend-schema-2026-10-21.json','utf8'));
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
const tables=[...new Set(schema.columns.map(c=>c.table_name))];
for(const table of tables){
 const columns=schema.columns.filter(c=>c.table_name===table).map(c=>`"${c.column_name}" ${c.udt_name.startsWith('_')?c.udt_name.slice(1)+'[]':c.udt_name}${c.column_default?' DEFAULT '+c.column_default:''}${c.is_nullable==='NO'?' NOT NULL':''}`);
 await db.exec(`CREATE TABLE public."${table}" (${columns.join(',')});`);
}
for(const c of schema.constraints.filter(c=>c.contype!=='f'))await db.exec(`ALTER TABLE public."${c.table_name}" ADD CONSTRAINT "${c.conname}" ${c.definition}`);
for(const c of schema.constraints.filter(c=>c.contype==='f'))await db.exec(`ALTER TABLE public."${c.table_name}" ADD CONSTRAINT "${c.conname}" ${c.definition}`);
// The captured credit schema predates lyric reads of the existing replacement pipeline.
// Only the columns read by the resolver are needed here; promotion itself is not simulated.
await db.exec('CREATE TABLE IF NOT EXISTS public.audio_master_revisions(entity_kind text,entity_id uuid,staged_master_key text,status text,hls_prefix text); CREATE TABLE IF NOT EXISTS public.hls_manifests(hls_prefix text,duration_seconds numeric);');
await db.exec(await fs.readFile('supabase/migrations/20261021010000_release_credit_contract.sql','utf8'));
await db.exec(await fs.readFile('supabase/migrations/20261021020000_atomic_credit_publication.sql','utf8'));

await db.exec(await fs.readFile('supabase/migrations/20261022010000_atomic_lyric_timing_edits.sql','utf8'));
return db;
}
