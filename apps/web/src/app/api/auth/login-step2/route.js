import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

export async function POST(req) {
  try {
    // AUTH-02: this route had NO rate limiting at all. Even with the atomic
    // attempt counter below, an unlimited endpoint lets an attacker burn through
    // OTP issuances. Keyed by IP because the pending cookie is attacker-supplied.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkRateLimit(req, {
      routeKey: "auth.login-step2",
      limit: 10,
      windowSeconds: 60,
      identifier: ip,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    const body = await req.json().catch(() => ({}));
    const raw  = String(body.code || "").replace(/\D/g, "");

    if (raw.length !== 6) {
      return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
    }

    const cookieStore = await cookies();
    const pendingRaw  = cookieStore.get("_2fa_pending")?.value;

    if (!pendingRaw) {
      return NextResponse.json(
        { error: "Session expired. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    let pending;
    try { pending = JSON.parse(pendingRaw); } catch {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Session corrupted. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    const { access_token, refresh_token, user_id, challenge_id } = pending;
    if (!user_id || !access_token || !refresh_token) {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Session expired. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    // challenge_id is REQUIRED. A cookie minted before the challenge-binding
    // amendment carries none, and there is deliberately no weaker fallback to
    // "this user's newest OTP" to accept it with. Reject and re-issue instead.
    //
    // The transition cost is bounded to nothing meaningful: _2fa_pending has a
    // 600-second maxAge, so at most a ten-minute window of in-flight logins is
    // asked to sign in again.
    if (!challenge_id) {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Session expired. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    const admin    = getAdminClient();
    const codeHash = hashCode(raw);

    // AUTH-02: find → increment → compare → burn, as ONE atomic database
    // operation. The previous implementation read `attempts`, added one in JS,
    // and wrote it back — so N parallel guesses all read the same value and the
    // three-attempt lockout counted one. Combined with the missing rate limit
    // above, the 10^6 code space was reachable by parallel submission.
    const { data: rows, error: consumeError } = await admin.rpc("consume_login_otp", {
      p_user_id: user_id,
      p_code_hash: codeHash,
      p_max_attempts: 3,
      // Bind to the exact challenge issued by login-step1. Guaranteed present
      // by the guard above — the function has no nullable fallback.
      p_challenge_id: challenge_id,
    });

    if (consumeError) {
      console.error("[login-step2] consume_login_otp:", consumeError.message);
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }

    const outcome = Array.isArray(rows) ? rows[0] : rows;
    const result = outcome?.result;

    if (result === "expired") {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Code expired. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    if (result === "locked") {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Too many incorrect attempts. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    if (result !== "ok") {
      const left = Number(outcome?.attempts_left ?? 0);
      return NextResponse.json(
        { error: `Incorrect code. ${left} attempt${left !== 1 ? "s" : ""} remaining.` },
        { status: 401 }
      );
    }

    // Correct code — the function already marked it used.
    cookieStore.delete("_2fa_pending");

    // Apply the real Supabase session
    const supabase = await createClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (sessionError || !sessionData?.session) {
      return NextResponse.json(
        { error: "Could not establish session. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true, session: sessionData.session });
  } catch (err) {
    console.error("[login-step2]", err?.message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
