import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getGiftByToken,
  giftPublicState,
  expireGiftIfNeeded,
} from "@/lib/gifts/helpers";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { hashGiftLinkToken } from "@/lib/gifts/token-hash";
import { validateEmail } from "@/lib/auth/validation";
import { persistNewUserProfileOrRollback } from "@/lib/auth/provision-new-user";
import { buildWelcomeEmail, sendTransactionalEmail } from "@/lib/server/email";
import { geocodeProfileIfNeeded } from "@/lib/geo/geocode-profile";
import { readAttributionCookie } from "@/lib/auth/attribution-cookie";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email: rawEmail, password, name, phone, giftToken, city, state, country, gender, age_range } = body;

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
    if (!country || !String(country).trim()) {
      return NextResponse.json({ error: "Country is required" }, { status: 400 });
    }
    if (String(country).trim() === "United States" && !String(state || "").trim()) {
      return NextResponse.json({ error: "State is required for U.S. locations" }, { status: 400 });
    }
    if (!giftToken) return NextResponse.json({ error: "Gift token required" }, { status: 400 });

    const email = emailCheck.value;

    // Verify the gift is still valid before creating an account
    let gift = await getGiftByToken(giftToken);
    if (!gift) return NextResponse.json({ error: "Gift not found" }, { status: 404 });

    gift = await expireGiftIfNeeded(gift);
    const { state: giftState } = giftPublicState(gift);
    if (!["valid", "claimed"].includes(giftState)) {
      return NextResponse.json({ error: `Gift is ${giftState}` }, { status: 410 });
    }

    // Gift-link possession does not prove inbox control. This is only an address
    // match for signup; ownership still requires the separate email-only challenge.
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

    const VALID_GENDERS = ["male", "female"];
    const VALID_AGE_RANGES = ["18-25", "25-40", "40-65"];
    const firstTouch = await readAttributionCookie();
    const profileProvision = await persistNewUserProfileOrRollback(admin, {
      userId: newUser.id,
      logPrefix: "claim-signup",
      profile: {
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
        first_touch: firstTouch,
      },
    });
    if (!profileProvision.ok) {
      return NextResponse.json(
        { error: "Account setup could not be completed. Please try again." },
        { status: 500 }
      );
    }

    // Best-effort analytics enrichment — never blocks or affects account claim.
    geocodeProfileIfNeeded(admin, { userId: newUser.id, city, state, country }).catch(() => {});

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

    // Account creation is not ownership proof. The gift page requests fresh
    // email-only verification after the session has been established.
    const giftClaimData = null;

    // Welcome email — non-blocking, non-fatal
    sendTransactionalEmail({
      to: email,
      ...buildWelcomeEmail({ name: String(name || "").trim() }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, session: signInData.session, gift: giftClaimData, verificationRequired: true });
  } catch (err) {
    console.error("[claim-signup] error:", err?.message);
    return NextResponse.json({ error: err?.message || "Sign up failed" }, { status: 500 });
  }
}
