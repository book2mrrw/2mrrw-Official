import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getAdminClient } from "@/lib/supabase/admin";
import { playlistWriteGateResponse } from "@/lib/playlists/write-gate";
import { userCanStreamProduct } from "@/lib/commerce/entitlements";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

async function mutate(req, {params}, action) {
  const user = await getFanSessionUser();
  if (!user || user.isGuest) return NextResponse.json({error:"Unauthorized"}, {status:401});
  const limit = await checkRateLimit(req, {routeKey:`playlists.tracks.${action}`,limit:120,windowSeconds:60,identifier:user.id});
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  const gated = playlistWriteGateResponse();
  if (gated) return gated;
  const {id} = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) return NextResponse.json({error:"Reload this playlist before editing",code:"PLAYLIST_REVISION_REQUIRED"},{status:409});
  let payload;
  if (action === 'add') {
    if (typeof body.trackSlug !== 'string' || !body.trackSlug || (body.albumSlug != null && typeof body.albumSlug !== 'string')) return NextResponse.json({error:"Invalid track identity"},{status:400});
    payload = {trackSlug:body.trackSlug,albumSlug:body.albumSlug || null,trackData:body.trackData || {}};
    // Playlist references do not grant rights. Resolve the owning product using
    // authenticated server state, never trackData.access or caller tier flags.
    try {
      if (!await userCanStreamProduct(user.id, payload.albumSlug || payload.trackSlug, user)) {
        return NextResponse.json({error:"Purchase or membership access is required to add this track",code:"PLAYLIST_ENTITLEMENT_REQUIRED"},{status:403});
      }
    } catch {
      return NextResponse.json({error:"Access could not be verified. Your track was not saved.",code:"PLAYLIST_ENTITLEMENT_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store","Retry-After":"60"}});
    }
  } else {
    const keys = action === 'reorder' ? (body.trackKeys || body.trackIds) : [body.trackKey];
    if (!Array.isArray(keys) || keys.some(k => typeof k !== 'string' || !k) || new Set(keys).size !== keys.length) return NextResponse.json({error:"Invalid track keys"},{status:400});
    payload = {keys};
  }
  const {data,error} = await getAdminClient().rpc('mutate_playlist_tracks', {
    p_playlist_id:id,p_user_id:user.id,p_revision:body.revision,p_action:action,p_payload:payload,
  });
  if (error) {
    const status = error.code === '42501' ? 404 : error.code === '40001' ? 409 : ['22023','22P02'].includes(error.code) ? 400 : 500;
    return NextResponse.json({error:status===500?'Playlist could not be saved':error.message},{status});
  }
  return NextResponse.json({ok:true,revision:data.revision});
}
export const POST = (req, context) => mutate(req, context, 'add');
export const PUT = (req, context) => mutate(req, context, 'reorder');
export const DELETE = (req, context) => mutate(req, context, 'remove');
