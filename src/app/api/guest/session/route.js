import { NextResponse } from "next/server";
import { clearGuestCookie, createOrRetrieveGuest, getGuestUser, withGuestCookie } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function GET() {
  try {
    const user = await getGuestUser();
    return NextResponse.json({ user });
  } catch (err) {
    console.error("guest session get error:", err);
    return NextResponse.json({ error: err.message || "Session failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const limit = await checkRateLimit(req, {
      routeKey: "guest.session.create",
      limit: 5,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const { email, phone, name } = await req.json();
    const user = await createOrRetrieveGuest({ email, phone, name });
    return withGuestCookie(NextResponse.json({ user }), user.id);
  } catch (err) {
    console.error("guest session create error:", err);
    return NextResponse.json({ error: err.message || "Could not create guest" }, { status: 500 });
  }
}

export async function DELETE() {
  return clearGuestCookie();
}
