import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import {
  resetMfaAuthorityForUser,
  revokeCurrentMfaAuthority,
  verifyMfaAuthority,
} from "@/lib/auth/mfa-authority";

export const dynamic = "force-dynamic";

/** Normalized, non-authoritative UI/diagnostic state. Enforcement stays server-side. */
export async function GET() {
  const user = await getFanSessionUser();
  if (!user?.id) {
    return NextResponse.json({ authenticated: false, admin: false, mfaVerified: false },
      { headers: { "Cache-Control": "no-store" } });
  }
  const admin = isAdminUser(user);
  const mfa = admin ? await verifyMfaAuthority({ userId: user.id }) : { ok: false, reason: "not_admin" };
  return NextResponse.json({
    authenticated: true,
    admin,
    mfaVerified: Boolean(mfa.ok),
    mfaReason: mfa.ok ? null : mfa.reason,
  }, { headers: { "Cache-Control": "no-store" } });
}
export async function DELETE() {
  await revokeCurrentMfaAuthority("sign_out");
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/** Authenticated password/security-reset invalidation. Never grants authority. */
export async function POST() {
  const user = await getFanSessionUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    await resetMfaAuthorityForUser(user.id, "password_reset");
    await revokeCurrentMfaAuthority("password_reset");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Security reset failed" }, { status: 503 });
  }
}
