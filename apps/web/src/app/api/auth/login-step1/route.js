import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendSMS } from "@/lib/server/twilio";
import { sendTransactionalEmail } from "@/lib/server/email";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import crypto from "crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function generateCode() {
  return String(100000 + crypto.randomInt(900000));
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await checkRateLimit(req, {
      routeKey: "auth.login-step1",
      limit: 10,
      windowSeconds: 60,
      identifier: ip,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const body = await req.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Verify credentials via Supabase REST — never returns which field is wrong
    const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseAnon },
      body: JSON.stringify({ email: String(email).trim().toLowerCase(), password }),
    });
    const authData = await authRes.json();

    if (!authRes.ok || !authData.access_token) {
      return NextResponse.json(
        { error: "Invalid email or password. If you have not set a password yet, use Forgot Password to create one." },
        { status: 401 }
      );
    }

    const userId    = authData.user?.id;
    const userEmail = authData.user?.email;
    if (!userId) return NextResponse.json({ error: "Authentication failed" }, { status: 401 });

    // Get phone from profile
    const admin = getAdminClient();
    const { data: profile } = await admin.from("profiles").select("phone").eq("id", userId).maybeSingle();

    // Generate 6-digit OTP
    const code     = generateCode();
    const codeHash = hashCode(code);

    // Clear any prior unused OTPs for this user
    await admin.from("login_otp").delete().eq("user_id", userId).eq("used", false);

    // Store new OTP
    await admin.from("login_otp").insert({
      user_id:    userId,
      code_hash:  codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    // Hold session tokens in HTTP-only cookie until 2FA complete
    const cookieStore = await cookies();
    cookieStore.set("_2fa_pending", JSON.stringify({
      access_token:  authData.access_token,
      refresh_token: authData.refresh_token,
      user_id:       userId,
    }), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   600,
      path:     "/",
    });

    // Email the code
    const html = `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:40px 32px;background:#0d0d0d;color:white;border-radius:16px;text-align:center"><div style="font-size:13px;font-weight:900;letter-spacing:6px;color:#00ffff;margin-bottom:32px">2MRRW</div><p style="font-size:15px;margin:0 0 24px;color:#ccc">Your login code</p><div style="font-size:52px;font-weight:900;letter-spacing:14px;color:#00ffff;margin:0 0 28px">${code}</div><p style="color:#666;font-size:13px;margin:0">Expires in 10 minutes. Never share this code.</p></div>`;
    await sendTransactionalEmail({
      to:      userEmail,
      subject: `${code} is your 2MRRW code`,
      html,
      text: `Your 2MRRW login code is ${code}. Expires in 10 minutes. Do not share this code.`,
    }).catch(() => {});

    // SMS the code
    if (profile?.phone) {
      await sendSMS({
        to:   profile.phone,
        body: `Your 2MRRW login code is ${code}. Expires in 10 minutes. Do not share.`,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, hasPhone: Boolean(profile?.phone) });
  } catch (err) {
    console.error("[login-step1]", err?.message);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
