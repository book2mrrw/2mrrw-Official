import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getFanSessionUser } from '@/lib/auth/session-user';
import { getGuestUser } from '@/lib/guest-session';
import { resolveReleaseAccessForProduct } from '@/lib/releases/release-availability-server';
import { userCanStreamProduct } from '@/lib/commerce/entitlements';
import { isAdminUser } from '@/lib/auth/constants';
import { signVisualToken } from '@/lib/track-visuals/token';
import { checkRateLimit, rateLimitResponse } from '@/lib/server/rate-limit';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(req) {
  // Enable only after the independent worker and delivery checks pass.
  if (process.env.TRACK_VISUALS_ENABLED !== 'true') return json({ visual: null });
  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) return json({ visual: null });
  const limit = await checkRateLimit(req, { routeKey: 'track-visuals.discovery', identifier: user.id, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const slug = req.nextUrl.searchParams.get('slug'), trackSlug = req.nextUrl.searchParams.get('trackSlug');
    if (!slug || slug.length > 300 || (trackSlug?.length || 0) > 300) return json({ error: 'Invalid track' }, 400);
    const admin = getAdminClient();
    const product = await admin.from('products').select('release_id').eq('slug', slug).maybeSingle();
    if (product.error) throw product.error;
    const releaseId = product.data?.release_id;
    if (!releaseId) return json({ visual: null });
    let trackId;
    if (trackSlug && trackSlug !== slug) {
      const track = await admin.from('catalog_tracks').select('track_id').eq('album_slug', slug).eq('slug', trackSlug).maybeSingle();
      if (track.error) throw track.error;
      trackId = track.data?.track_id;
      if (!trackId) return json({ visual: null });
    }
    let tracks = admin.from('tracks').select('id').eq('release_id', releaseId);
    if (trackId) tracks = tracks.eq('id', trackId);
    const result = await tracks.limit(2);
    if (result.error) throw result.error;
    if (result.data?.length !== 1) return json({ visual: null });
    trackId = result.data[0].id;
    const access = await resolveReleaseAccessForProduct({ slug, user, trackId });
    if (!isAdminUser(user) && !(access.availability ? access.availability.canPlayFull : await userCanStreamProduct(user.id, slug, user))) return json({ visual: null });
    const owner = await admin.from('track_visuals').select('current_version_id').eq('track_id', trackId).maybeSingle();
    if (owner.error) throw owner.error;
    const versionId = owner.data?.current_version_id;
    if (!versionId) return json({ visual: null });
    const token = signVisualToken(versionId);
    return json({ visual: { versionId, trackId, manifestUrl: `/api/track-visuals/${versionId}/manifest?${new URLSearchParams({ token })}` } });
  } catch { return json({ error: 'Visual unavailable' }, 503); }
}
