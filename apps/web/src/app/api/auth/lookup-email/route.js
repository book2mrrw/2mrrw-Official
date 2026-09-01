import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { validateEmail } from "@/lib/auth/validation";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(request) {
  try {
    const limit = await checkRateLimit(request, {
      routeKey: "auth.lookup-email",
      limit: 10,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const body = await request.json().catch(() => ({}));
    const emailCheck = validateEmail(body.email);
    if (!emailCheck.ok) {
      return NextResponse.json({ exists: false });
    }

    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("email", emailCheck.value)
      .limit(1);

    if (error) throw error;

    const match = (rows || []).find((row) => {
      const email = String(row.email || "").trim().toLowerCase();
      return email && !email.endsWith("@guest.2mrrw.local");
    });

    if (!match) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      email: String(match.email || "").trim().toLowerCase(),
      name: String(match.full_name || "").trim(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Lookup failed" }, { status: 500 });
  }
}
