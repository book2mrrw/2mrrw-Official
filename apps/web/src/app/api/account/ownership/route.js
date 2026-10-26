import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { getGiftByToken } from '@/lib/gifts/helpers';
import { createOwnershipRecovery } from '@/lib/commerce/ownership-recovery';
import { ownershipTransaction } from '@/lib/commerce/ownership-transaction';
import { sendTransactionalEmail } from '@/lib/server/email';

export const runtime = 'nodejs';
const COOKIE = 'ownership_challenge';
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/account/ownership', maxAge: 300 });
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(req) {
  // JSON + exact Origin + HttpOnly SameSite cookie. Native Origins need a separately
  // verified transport contract; this endpoint does not silently allow arbitrary apps.
  if (req.headers.get('origin') !== new URL(req.url).origin || !req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'origin_required' }, 403);
  let body;
  try { const raw = await req.text(); if (raw.length > 4096) return json({ error: 'invalid_request' }, 400); body = JSON.parse(raw); } catch { return json({ error: 'invalid_request' }, 400); }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return json({ error: error ? 'session_unavailable' : 'sign_in_required' }, error ? 503 : 401);
    const actor = { id: data.user.id, email: data.user.email };
    const service = createOwnershipRecovery({ transaction: ownershipTransaction, admin: getAdminClient(), sendEmail: sendTransactionalEmail });
    if (body.action === 'start') {
      const gift = body.purpose === 'claim_gift' && body.giftToken ? await getGiftByToken(body.giftToken) : null;
      const result = await service.start({ actor, purpose: body.purpose, gift });
      const { handle, ...publicResult } = result;
      const response = json(publicResult);
      response.cookies.set(COOKIE, handle || '', { ...cookieOptions(), maxAge: handle ? 300 : 0 });
      return response;
    }
    if (body.action === 'cancel') {
      const result = await service.cancel({ actor, purpose: body.purpose, challengeId: body.challengeId, handle: req.cookies.get(COOKIE)?.value });
      const response = json(result); response.cookies.set(COOKIE, '', { ...cookieOptions(), maxAge: 0 }); return response;
    }
    if (body.action === 'verify') {
      const result = await service.complete({ actor, purpose: body.purpose, challengeId: body.challengeId, code: body.code, handle: req.cookies.get(COOKIE)?.value });
      const response = json(result);
      response.cookies.set(COOKIE, '', { ...cookieOptions(), maxAge: 0 });
      return response;
    }
    return json({ error: 'invalid_action' }, 400);
  } catch (err) {
    // Never return database/provider errors, OTPs, or handles. No secret-bearing logs.
    return json({ error: err?.status ? err.code : 'ownership_service_unavailable' }, err?.status || 503);
  }
}
