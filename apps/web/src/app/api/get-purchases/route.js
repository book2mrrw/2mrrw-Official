import { NextResponse } from "next/server";
import { retiredRouteGuard } from "@/lib/auth/retired-route";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(req) {
  const retired = retiredRouteGuard("/api/get-purchases");
  if (retired) return retired;

  try {
    const supabase = getAdminClient();
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("purchases")
      .select("*")
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ purchases: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
