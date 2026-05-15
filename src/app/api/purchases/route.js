import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ purchases: [] }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("purchases")
    .select("*")
    .eq("user_id", user.id)
    .order("purchased_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ purchases: data || [] });
}
