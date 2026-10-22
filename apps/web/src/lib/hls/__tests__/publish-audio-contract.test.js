import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent('export function resolve(s,c,next){return next(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);
mock.module('next/server', { namedExports: { NextResponse: Response } });
let tracks, copies, deletions, writes, submissions, failure, commitFailure;
const release = { id: '11111111-1111-4111-8111-111111111111', slug: 'release', status: 'published', release_type: 'single', cover_art_r2_key: 'images/singles/release/release.webp', metadata: {}, content_kind: 'music' };
const admin = { async rpc(name,args) {
  if(name==='credit_storage_capabilities')return {data:{version:1,private_allocations:true,service_role_only:true},error:null};
  if(name==='get_release_publication_revision')return {data:{release:'fixture'},error:null};
  if(name==='commit_release_publication'){
    if(commitFailure)return {data:null,error:{code:'40001'}};
    const payload=args.p_payload;
    writes.push({table:'products',operation:'transaction',payload:payload.product});
    if(payload.catalog_tracks.length)writes.push({table:'catalog_tracks',operation:'transaction',payload:payload.catalog_tracks});
    writes.push({table:'releases',operation:'transaction',payload:payload.release});
    for(const row of payload.recordings)Object.assign(tracks.find(track=>track.id===row.id),row);
    return {data:{product_id:'product'},error:null};
  }
  throw new Error('Unexpected RPC '+name);
}, from(table) {
  let payload, operation;
  const result = () => {
    if (operation) {
      writes.push({ table, operation, payload });
      if (table === 'tracks' && operation === 'update') Object.assign(tracks[0], payload);
      return { data: table === 'products' ? { id: 'product' } : null, error: null };
    }
    return { data: table === 'releases' ? release : table === 'tracks' ? tracks : null, error: null };
  };
  const q = { select: () => q, eq: () => q, is: () => q, update: p => { payload = p; operation = 'update'; return q; },
    upsert: p => { payload = p; operation = 'upsert'; return q; }, delete: () => { operation = 'delete'; return q; },
    single: async () => result(), maybeSingle: async () => result(), then: resolve => Promise.resolve(result()).then(resolve) };
  return q;
} };
mock.module('@/lib/auth/admin-api-guard', { namedExports: { getAdminSessionUser: async () => ({ id: 'admin' }) } });
mock.module('@/lib/auth/constants', { namedExports: { isAdminUser: () => true } });
mock.module('@/lib/supabase/admin', { namedExports: { getAdminClient: () => admin } });
mock.module('@/lib/storage/r2', { namedExports: { listR2Objects:async()=>[], getR2ObjectMetadata:async()=>({etag:'fixture',contentLength:100}), discoverFileByExtensions:async()=>null, getPublicR2Url: key => `https://cdn.example.test/${key}`, headR2ObjectKey: async () => true, copyR2Object: async (...args) => copies.push(args), deleteR2Object: async key => deletions.push(key) } });
mock.module('@/lib/server/rate-limit', { namedExports: { checkRateLimit: async () => ({ allowed: true }), rateLimitResponse: () => new Response() } });
mock.module('@/lib/media/revalidate-storefront', { namedExports: { revalidateStorefront: () => {} } });
mock.module('@/lib/media/entity-resolver', { namedExports: { clearEntityResolverCaches: () => {} } });
mock.module('@/lib/playback/resolve-playback-key', { namedExports: { clearPersistedPreviewKey: async () => {} } });
mock.module('@/lib/hls/submit-audio-job', { namedExports: { submitAudioJob: async args => { submissions.push(args); if (failure) throw failure; return { id: 'job' }; } } });
const { POST } = await import('../../../app/api/admin/releases/[id]/publish/route.js');
const publish = () => POST(new Request('https://example.test/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Release', audio_key: 'uncommitted.wav' }) }), { params: Promise.resolve({ id: release.id }) });
beforeEach(() => { tracks = [{ id: 'track', title: 'Song', position: 1, upload_status: 'ready', audio_r2_key: 'digital-assets/singles/draft-123/source.wav', master_r2_key: 'digital-assets/singles/draft-123/source.wav' }]; copies = []; deletions = []; writes = []; submissions = []; failure = null; commitFailure = false; });
test('publish uses a unique canonical source, preserves draft input, and records exact playback pointer', async () => {
  const response = await publish();
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(copies.length, 1);
  assert.match(copies[0][1], /^digital-assets\/singles\/release\/release-[a-f0-9-]+\.wav$/);
  assert.deepEqual(deletions, []);
  assert.equal(submissions[0].sourceKey, copies[0][1]);
  assert.equal(submissions[0].reuseComplete, true);
  assert.equal(writes.find(w => w.table === 'products').payload.metadata.audio_key, copies[0][1]);
});
test('a publish retry keeps the same canonical source and does not recopy worker input', async () => {
  assert.equal((await publish()).status, 200);
  const source = submissions[0].sourceKey;
  assert.equal((await publish()).status, 200);
  assert.equal(copies.length, 1);
  assert.equal(submissions[1].sourceKey, source);
});
test('encoding conflict blocks publication without deleting source or updating public catalog', async () => {
  failure = Object.assign(new Error('Already processing'), { status: 409 });
  assert.equal((await publish()).status, 409);
  assert.deepEqual(deletions, []);
  assert.equal(writes.some(w => w.table === 'products' || w.table === 'releases'), false);
});
test('a body-only audio key cannot bypass durable upload completion and encoding', async () => {
  tracks = [];
  assert.equal((await publish()).status, 422);
  assert.equal(submissions.length, 0);
  assert.equal(writes.length, 0);
});
test('album publication records each exact source on the track projection', async () => {
  release.release_type = 'album';
  release.cover_art_r2_key = 'images/albums/release/release.webp';
  try {
    assert.equal((await publish()).status, 200);
    const row = writes.find(w => w.table === 'catalog_tracks').payload[0];
    assert.equal(row.metadata.audio_key, submissions[0].sourceKey);
    assert.equal(submissions[0].trackSlug, row.slug);
    assert.equal(submissions[0].releaseType, 'albums');
    assert.equal(deletions.length, 0);
  } finally {
    release.release_type = 'single';
    release.cover_art_r2_key = 'images/singles/release/release.webp';
  }
});

test('a revision conflict does not expose partially committed catalog or metadata', async () => {
  commitFailure=true;
  assert.equal((await publish()).status,409);
  assert.equal(writes.length,0);
  assert.deepEqual(deletions,[]);
  assert.match(tracks[0].audio_r2_key,/draft-123/);
});
