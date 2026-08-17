import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/auth/constants";
import { sendTransactionalEmail, buildWelcomeEmail } from "@/lib/server/email";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

function isMissingColumnError(error) {
  const msg = String(error?.message || "");
  return /column|role|phone_verified/i.test(msg);
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id || user.email?.endsWith("@guest.2mrrw.local")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await checkRateLimit(request, {
      routeKey: "auth.complete-profile",
      limit: 10,
      windowSeconds: 60,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const body = await request.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const email = String(body.email || user.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();

    let admin;
    try {
      admin = getAdminClient();
    } catch (err) {
      console.error("complete-profile admin client:", err?.message || err);
      return NextResponse.json({ error: "Profile service unavailable" }, { status: 503 });
    }

    let existingRole = null;
    const { data: existing, error: existingError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingError) {
      existingRole = existing?.role ?? null;
    } else if (!isMissingColumnError(existingError)) {
      throw existingError;
    }

    const role =
      existingRole === "admin" || isAdminUser(user) ? "admin" : "user";

    const fullRow = {
      id: user.id,
      email,
      phone: phone || null,
      full_name: name || "",
      phone_verified: Boolean(phone),
      role,
    };

    let { error } = await admin.from("profiles").upsert(fullRow, { onConflict: "id" });

    if (error && isMissingColumnError(error)) {
      const minimalRow = {
        id: user.id,
        email,
        phone: phone || null,
        full_name: name || "",
      };
      ({ error } = await admin.from("profiles").upsert(minimalRow, { onConflict: "id" }));
    }

    if (error) throw error;

    // Send welcome email only for brand-new profiles, not updates.
    if (!existing && email) {
      try {
        const { subject, html, text } = buildWelcomeEmail({ name });
        await sendTransactionalEmail({ to: email, subject, html, text });
      } catch {
        // Non-fatal — profile already created, email is best-effort
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("complete-profile error:", err?.message || err);
    return NextResponse.json(
      { error: err.message || "Profile update failed" },
      { status: 500 }
    );
  }
}
