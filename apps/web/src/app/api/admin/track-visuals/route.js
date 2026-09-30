import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminSessionUser } from '@/lib/auth/admin-api-guard';
import { isAdminUser } from '@/lib/auth/constants';
import { getAdminClient } from '@/lib/supabase/admin';
import { createR2SignedPutUrl, getR2ObjectMetadata } from '@/lib/storage/r2';
import { checkRateLimit, rateLimitResponse } from '@/lib/server/rate-limit';
import { UUID_RE, VISUAL_MAX_BYTES, visualSourceKey, visualUploadType } from '@/lib/track-visuals/contract';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status });
async function actor(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) return { response: json({ error: 'Unauthorized' }, 401) };
  const limit = await checkRateLimit(req, { routeKey: 'admin.track-visuals', identifier: user.id, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return { response: rateLimitResponse(limit.retryAfterSeconds) };
  return { admin: getAdminClient() };
}
async function trackFor(admin, trackId, releaseId) {
  if (!UUID_RE.test(trackId || '') || !UUID_RE.test(releaseId || '')) return null;
  const { data, error } = await admin.from('tracks').select('id,release_id').eq('id', trackId).eq('release_id', releaseId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function GET(req) {
  const gate = await actor(req); if (gate.response) return gate.response;
  if (process.env.TRACK_VISUALS_ENABLED !== 'true') return json({ enabled: false });
  try {
    const trackId = req.nextUrl.searchParams.get('trackId'), releaseId = req.nextUrl.searchParams.get('releaseId');
    if (!await trackFor(gate.admin, trackId, releaseId)) return json({ error: 'Track not found' }, 404);
    const { data, error } = await gate.admin.from('track_visuals').select('current_version_id,requested_version_id').eq('track_id', trackId).maybeSingle();
    if (error) throw error;
    let version = null;
    if (data?.requested_version_id) {
      const result = await gate.admin.from('track_visual_versions').select('id,status,error_message').eq('id', data.requested_version_id).single();
      if (result.error) throw result.error;
      version = result.data;
    }
    return json({ enabled: true, currentVersionId: data?.current_version_id || null, version });
  } catch { return json({ error: 'Could not read visual status' }, 503); }
}
export async function POST(req) {
  const gate = await actor(req); if (gate.response) return gate.response;
  if (process.env.TRACK_VISUALS_ENABLED !== 'true') return json({ error: 'Track visuals are not enabled yet' }, 503);
  let body; try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { admin } = gate;
  try {
    if (!await trackFor(admin, body.trackId, body.releaseId)) return json({ error: 'Track does not belong to this release' }, 404);
    if (body.action === 'prepare') {
      const type = visualUploadType(body.filename);
      if (!type || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > VISUAL_MAX_BYTES) return json({ error: 'Choose an MP4 or MOV up to 5 GB, between 7 and 30 seconds' }, 400);
      const versionId = randomUUID(), key = visualSourceKey(body.trackId, versionId, body.filename);
      const result = await admin.rpc('prepare_track_visual', {
        p_track_id: body.trackId, p_version_id: versionId, p_source_key: key,
        p_source_bytes: body.size, p_source_content_type: type,
      });
      if (result.error) throw result.error;
      return json({ versionId, uploadUrl: await createR2SignedPutUrl(key, type, 3600), contentType: type });
    }
    if (body.action === 'complete' && UUID_RE.test(body.versionId || '')) {
      const { data: v, error } = await admin.from('track_visual_versions').select('*').eq('id', body.versionId).eq('track_id', body.trackId).single();
      if (error) throw error;
      const object = await getR2ObjectMetadata(v.source_key);
      if (!object || object.contentLength !== Number(v.source_bytes) || object.contentType !== v.source_content_type) return json({ error: 'Uploaded file failed storage verification' }, 422);
      const queued = await admin.rpc('queue_track_visual', { p_track_id: body.trackId, p_version_id: v.id });
      if (queued.error) throw queued.error;
      if (!queued.data) return json({ error: 'A newer visual upload replaced this request' }, 409);
      return json({ ok: true, versionId: v.id });
    }
    if (body.action === 'remove') {
      const { error } = await admin.from('track_visuals').update({ current_version_id: null, requested_version_id: null }).eq('track_id', body.trackId);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: 'Invalid action' }, 400);
  } catch (error) { console.error('[track-visuals]', error.message); return json({ error: 'Visual operation failed; music is unchanged' }, 503); }
}
