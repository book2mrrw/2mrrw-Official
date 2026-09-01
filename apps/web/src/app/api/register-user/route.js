import { NextResponse } from "next/server";
import { retiredRouteGuard } from "@/lib/auth/retired-route";
import { getAdminClient } from "@/lib/supabase/admin";

export async function POST(req) {
  const retired = retiredRouteGuard("/api/register-user");
  if (retired) return retired;

  try {
    const supabase = getAdminClient();
    const { name, phone, email } = await req.json();

    const { data, error } = await supabase
      .from("users")
      .upsert({ name, phone, email }, { onConflict: "email" })
      .select()
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
