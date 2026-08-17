import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGiftByToken, giftPublicState, expireGiftIfNeeded } from "@/lib/gifts/helpers";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { hashGiftLinkToken } from "@/lib/gifts/token-hash";
import { validateEmail } from "@/lib/auth/validation";
import { buildWelcomeEmail, sendTransactionalEmail } from "@/lib/server/email";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email: rawEmail, password, name, phone, giftToken } = body;

    const rl = await checkRateLimit(req, {
      routeKey: "gifts.claim-signup",
      limit: 5,
      windowSeconds: 300,
      identifier: hashGiftLinkToken(giftToken || rawEmail || ""),
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    const emailCheck = validateEmail(rawEmail);
    if (!emailCheck.ok) return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (!giftToken) return NextResponse.json({ error: "Gift token required" }, { status: 400 });

    const email = emailCheck.value;

    // Verify the gift is still valid before creating an account
    let gift = await getGiftByToken(giftToken);
    if (!gift) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

    gift = await expireGiftIfNeeded(gift);
    const { state } = giftPublicState(gift);
    if (state !== "valid") {
      return NextResponse.json({ error: `Gift is ${state}` }, { status: 410 });
    }

    // The gift token landing in the recipient's inbox proves email ownership,
    // so we enforce the email matches and skip Supabase's separate confirmation email.
    const giftEmail = String(gift.recipient_email || "").toLowerCase();
    if (giftEmail && giftEmail !== email) {
      return NextResponse.json(
        { error: "email_mismatch", message: `This gift was sent to ${giftEmail}. Use that email address to claim it.` },
        { status: 403 }
      );
    }

    const admin = getAdminClient();

    // email_confirm: true → account is immediately active, no confirmation email sent.
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
      console.error("[claim-signup] createUser:", createError.message);
      return NextResponse.json({ error: createError.message || "Account creation failed" }, { status: 500 });
    }

    const newUser = userData.user;

    await admin.from("profiles").upsert(
      {
        id: newUser.id,
        email,
        phone: String(phone || "").trim() || null,
        full_name: String(name || "").trim() || "",
        phone_verified: Boolean(String(phone || "").trim()),
        role: "user",
      },
      { onConflict: "id" }
    ).catch(() => {});

    // Sign in server-side — the SSR client writes the auth cookies into the response
    // headers so the browser is immediately authenticated after this API call returns.
    const supabase = await createClient();
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData?.session) {
      console.error("[claim-signup] signIn after creation:", signInError?.message);
      return NextResponse.json(
        { error: "Account created but sign-in failed. Please sign in to claim your gift." },
        { status: 500 }
      );
    }

    // Welcome email — non-blocking, non-fatal
    sendTransactionalEmail({
      to: email,
      ...buildWelcomeEmail({ name: String(name || "").trim() }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, session: signInData.session });
  } catch (err) {
    console.error("[claim-signup] error:", err?.message);
    return NextResponse.json({ error: err?.message || "Sign up failed" }, { status: 500 });
  }
}
