import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneDigits } from "@/lib/auth/validation";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const digits = normalizePhoneDigits(body.phone);
    if (digits.length < 10) {
      return NextResponse.json({ exists: false });
    }

    const tail = digits.slice(-10);
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("profiles")
      .select("email, full_name, phone")
      .not("phone", "is", null)
      .ilike("phone", `%${tail}%`)
      .limit(25);

    if (error) throw error;

    const match = (rows || []).find((row) => {
      const rowDigits = normalizePhoneDigits(row.phone);
      if (rowDigits !== digits) return false;
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
