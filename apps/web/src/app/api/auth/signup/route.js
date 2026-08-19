import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { validateEmail } from "@/lib/auth/validation";
import { buildWelcomeEmail, sendTransactionalEmail } from "@/lib/server/email";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email: rawEmail, password, name, phone, city, state, country, gender, age_range } = body;

    const emailCheck = validateEmail(rawEmail);
    if (!emailCheck.ok) return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (!country || !String(country).trim()) {
      return NextResponse.json({ error: "Country is required" }, { status: 400 });
    }
    if (String(country).trim() === "United States" && !String(state || "").trim()) {
      return NextResponse.json({ error: "State is required for U.S. locations" }, { status: 400 });
    }

    const email = emailCheck.value;

    const rl = await checkRateLimit(req, {
      routeKey: "auth.signup",
      limit: 5,
      windowSeconds: 300,
      identifier: email,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    const admin = getAdminClient();

    // email_confirm: true — account is immediately active, no confirmation email sent.
    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: String(name || "").trim() || undefined },
    });

    if (createError) {
      if (/already|exists|registered/i.test(createError.message)) {
        return NextResponse.json(
          { error: "An account with this email already exists.", existsHint: true },
          { status: 409 }
        );
      }
      console.error("[auth/signup] createUser:", createError.message);
      return NextResponse.json({ error: createError.message || "Account creation failed" }, { status: 500 });
    }

    const newUser = userData.user;

    const VALID_GENDERS = ["male", "female"];
    const VALID_AGE_RANGES = ["18-25", "25-40", "40-65"];
    await admin.from("profiles").upsert(
      {
        id: newUser.id,
        email,
        phone: String(phone || "").trim() || null,
        full_name: String(name || "").trim() || "",
        phone_verified: Boolean(String(phone || "").trim()),
        city: String(city || "").trim() || null,
        state: String(state || "").trim() || null,
        country: String(country || "").trim() || null,
        gender: VALID_GENDERS.includes(gender) ? gender : null,
        age_range: VALID_AGE_RANGES.includes(age_range) ? age_range : null,
        role: "user",
      },
      { onConflict: "id" }
    ).catch(() => {});

    // Sign in server-side so the SSR client writes auth cookies into the response.
    const supabase = await createClient();
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData?.session) {
      console.error("[auth/signup] signIn after creation:", signInError?.message);
      return NextResponse.json(
        { error: "Account created but sign-in failed. Please sign in manually." },
        { status: 500 }
      );
    }

    // Welcome email — non-blocking
    sendTransactionalEmail({
      to: email,
      ...buildWelcomeEmail({ name: String(name || "").trim() }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, session: signInData.session });
  } catch (err) {
    console.error("[auth/signup] error:", err?.message);
    return NextResponse.json({ error: err?.message || "Sign up failed" }, { status: 500 });
  }
}
