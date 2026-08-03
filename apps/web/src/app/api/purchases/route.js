import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";

export async function GET() {
  const user = await getGuestUser();

  if (!user) {
    return NextResponse.json({ purchases: [] }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchases")
    .select("*")
    .eq("user_id", user.id)
    .order("purchased_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ purchases: data || [] });
}
