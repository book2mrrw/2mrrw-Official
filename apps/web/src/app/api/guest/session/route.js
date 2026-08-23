import { NextResponse } from "next/server";
import { clearGuestCookie, getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

/**
 * Legacy session-cookie endpoint — READ and CLEAR only.
 *
 * ── Why POST is gone ────────────────────────────────────────────────────────
 *
 * This route used to mint session cookies for a principal class the product
 * does not admit. The platform has five tiers — Entry, Purchaser, Subscriber,
 * Collector card owner, Admin — and every one of them is a registered account.
 * `AuthGate` exists precisely so nobody uses the app without signing in, and
 * `authStatus` classifies a legacy session principal as **unauthenticated**
 * regardless of how valid its cookie is.
 *
 * So the minting half had no reachable caller and no principal class to serve,
 * while remaining a live authentication surface. It is deleted rather than
 * disabled: an endpoint that mints credentials for nobody is not made safe by
 * merely having no callers today.
 *
 * What remains is only what still has live callers:
 *
 *   GET     AuthContext reads a legacy cookie during session bootstrap
 *   DELETE  sign-out clears it
 *
 * Both exist solely to retire the remaining legacy cookies gracefully. Once the
 * observation window closes with no GET resolving a principal, this route,
 * `getGuestUser`, and `GUEST_SESSION_SECRET` all go too.
 */

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const limit = await checkRateLimit(req, {
      routeKey: "guest.session.get",
      limit: 20,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const user = await getGuestUser();

    // Retirement telemetry: this is the signal that decides when the remaining
    // legacy surface can be deleted. Silence over one cookie lifetime means the
    // last legacy cookie is gone.
    if (user) {
      console.info("[legacy-session] resolved a legacy cookie principal", { userId: user.id });
    }

    return NextResponse.json({ user });
  } catch (err) {
    console.error("guest session get error:", err);
    return NextResponse.json({ error: err.message || "Session failed" }, { status: 500 });
  }
}

export async function DELETE() {
  return clearGuestCookie();
}
