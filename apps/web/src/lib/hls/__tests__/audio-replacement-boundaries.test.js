import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent('export function resolve(s,c,next){return next(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);
mock.module('next/server', { namedExports: { NextResponse: class extends Response {
  static json(data, options) { return Response.json(data, options); }
} } });
const original = 'digital-assets/singles/song/master.wav';
let operations, job, exists, playbackLookups, clears;
const admin = { from(table) {
  let operation, payload;
  const result = () => {
    if (operation) { operations.push({ table, operation, payload }); return { data: { id: 'job', hls_prefix: 'hls/singles/song/versions/g8/' }, error: null }; }
    return { data: table === 'products' ? { storage_path: 'digital-assets/singles/song/', metadata: { audio_key: original } }
      : table === 'hls_transcode_jobs' ? job : null, error: null };
  };
  const q = { select: () => q, eq: () => q, is: () => q, in: () => q,
    update: value => { operation = 'update'; payload = value; return q; },
    insert: value => { operation = 'insert'; payload = value; return q; },
    delete: () => { operation = 'delete'; return q; },
    maybeSingle: async () => result(), single: async () => result(),
    then: resolve => Promise.resolve(result()).then(resolve) };
  return q;
} };
mock.module('@/lib/auth/admin-api-guard', { namedExports: { getAdminSessionUser: async () => ({ id: 'admin' }) } });
mock.module('@/lib/auth/constants', { namedExports: { isAdminUser: () => true } });
mock.module('@/lib/supabase/admin', { namedExports: { getAdminClient: () => admin } });
mock.module('@/lib/playback/resolve-playback-key', { namedExports: {
  resolvePlaybackKey: async () => { playbackLookups++; return { key: 'streaming/singles/song/song_192.m4a' }; },
  clearPersistedPlaybackKey: async () => { clears++; },
} });
mock.module('@/lib/media/cache-invalidation', { namedExports: { clearMediaResolverCaches: () => {} } });
mock.module('@/lib/server/hls-manifest-cache', { namedExports: { invalidateManifestCache: async () => {} } });
mock.module('@/lib/storage/r2', { namedExports: {
  R2_PREFIX: { DIGITAL_ASSETS: 'digital-assets', PROTECTED_MEDIA: 'protected-media' },
  buildR2Key: (prefix, path) => `${prefix}/${path}`,
  headR2ObjectKey: async () => exists, listR2Objects: async prefix => [{ Key: prefix.startsWith('hls/') ? 'hls/singles/song/versions/g7/320k/seg_00001.ts' : original }], R2_BUCKET: 'fixture',
  r2Client: { send: async command => {
    if (command.constructor.name === 'DeleteObjectCommand') { operations.push({ operation: 'object-delete' }); return {}; }
    const prefix = command.input.Prefix;
    return prefix === 'digital-assets/singles/' ? { CommonPrefixes: [{ Prefix: prefix + 'song/' }] }
      : prefix === 'digital-assets/singles/song/' ? { Contents: [{ Key: original }] } : {};
  } },
} });
const { POST: queue } = await import('../../../app/api/admin/hls/queue/route.js');
const { POST: sync } = await import('../../../app/api/admin/catalog/hls-sync-trigger/route.js');
const { invalidateAudioCacheAndRequeueTranscode: refresh } = await import('../../media/audio-cache-refresh.js');
const request = body => new Request('https://site.test/queue', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { operations = []; job = { id: 'job', status: 'complete', source_key: original,
  bitrates: ['320k', '160k', '96k', '64k'], generation: 7, updated_at: 'revision' }; exists = true; playbackLookups = clears = 0; });

test('manual queue reads original authority despite a cached listening rendition', async () => {
  const response = await queue(request({ slug: 'song', releaseType: 'singles' }));
  assert.equal(response.status, 200);
  assert.equal(operations.find(op => op.table === 'hls_transcode_jobs').payload.source_key, original);
  assert.equal(playbackLookups, 0);
});
test('explicit derived source is rejected before queue mutation', async () => {
  const response = await queue(request({ slug: 'song', sourceKey: 'streaming/singles/song/song_192.m4a' }));
  const body = await response.json();
  assert.equal(body.errors.length, 1);
  assert.equal(operations.length, 0);
});
test('catalog-wide sync also queues original bytes rather than a listening cache entry', async () => {
  const response = await sync();
  assert.equal(response.status, 200);
  assert.equal(operations.find(op => op.table === 'hls_transcode_jobs').payload.source_key, original);
  assert.equal(playbackLookups, 0);
});
test('refresh leaves published metadata and objects intact while queueing a new generation', async () => {
  const result = await refresh({ admin, slug: 'song', releaseType: 'singles' });
  assert.equal(result.steps.jobQueued, true);
  assert.equal(result.steps.publishedAudioPreserved, true);
  assert.deepEqual(operations.map(op => op.table), ['hls_transcode_jobs']);
  assert.equal(result.hlsPrefix, 'hls/singles/song/versions/g8/');
});
test('a conflicting in-flight encode cannot be cancelled or have its manifest removed by refresh', async () => {
  job.status = 'processing'; job.source_key = 'digital-assets/singles/song/previous.wav';
  const result = await refresh({ admin, slug: 'song', releaseType: 'singles' });
  assert.equal(result.status, 409);
  assert.equal(result.steps.jobQueued, false);
  assert.equal(operations.length, 0);
  assert.equal(clears, 0);
});
test('a missing original fails refresh without deleting the playable recording', async () => {
  exists = false;
  const result = await refresh({ admin, slug: 'song', releaseType: 'singles' });
  assert.equal(result.steps.sourceVerified, false);
  assert.equal(result.steps.jobQueued, false);
  assert.equal(operations.length, 0);
});
