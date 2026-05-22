import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/auth/constants";

export async function POST(request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id || user.email?.endsWith("@guest.2mrrw.local")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const phone = String(body.phone || "").trim();
    const email = String(body.email || user.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();

    const admin = createAdminClient();
    const { data: existing } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = existing?.role === "admin" || isAdminUser(user) ? "admin" : "user";

    const { error } = await admin.from("profiles").upsert({
      id: user.id,
      email,
      phone: phone || null,
      full_name: name || null,
      phone_verified: Boolean(phone),
      role,
    });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Profile update failed" }, { status: 500 });
  }
}
