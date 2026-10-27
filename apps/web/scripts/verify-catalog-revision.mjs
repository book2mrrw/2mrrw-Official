// Read-only. Run with the linked project's environment; never print credentials.
import assert from 'node:assert/strict';
assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),'Production URL is unavailable to the local verifier');
assert.ok(process.env.SUPABASE_SECRET_KEY,'Production secret is unavailable to the local verifier');
const origin=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim());
assert.equal(origin.hostname,'qvfbgkbgczyqrglvgyqr.supabase.co','Unexpected Supabase target');
const {getCatalogRefreshStateFromDB}=await import('../src/lib/media/catalog-refresh-state.js');
const first=await getCatalogRefreshStateFromDB();
const second=await getCatalogRefreshStateFromDB();
assert.match(first.revision,/^[a-f0-9]{64}$/);
assert.deepEqual(Object.keys(first),['revision']);
console.log(JSON.stringify({project:'qvfbgkbgczyqrglvgyqr',valid_revision:true,stable_between_reads:first.revision===second.revision,returned_fields:Object.keys(first)}));
