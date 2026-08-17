import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

export async function POST(req) {
  try {
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

    const { access_token, refresh_token, user_id } = pending;
    if (!user_id || !access_token || !refresh_token) {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Session expired. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    const admin    = getAdminClient();
    const codeHash = hashCode(raw);

    // Find active OTP
    const { data: otp } = await admin
      .from("login_otp")
      .select("*")
      .eq("user_id", user_id)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) {
      cookieStore.delete("_2fa_pending");
      return NextResponse.json(
        { error: "Code expired. Please log in again.", expired: true },
        { status: 401 }
      );
    }

    const newAttempts = otp.attempts + 1;
    await admin.from("login_otp").update({ attempts: newAttempts }).eq("id", otp.id);

    if (otp.code_hash !== codeHash) {
      if (newAttempts >= 3) {
        await admin.from("login_otp").update({ used: true }).eq("id", otp.id);
        cookieStore.delete("_2fa_pending");
        return NextResponse.json(
          { error: "Too many incorrect attempts. Please log in again.", expired: true },
          { status: 401 }
        );
      }
      const left = 3 - newAttempts;
      return NextResponse.json(
        { error: `Incorrect code. ${left} attempt${left !== 1 ? "s" : ""} remaining.` },
        { status: 401 }
      );
    }

    // Code correct — mark used, clear pending cookie
    await admin.from("login_otp").update({ used: true }).eq("id", otp.id);
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
