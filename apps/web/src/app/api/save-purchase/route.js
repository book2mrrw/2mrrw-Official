import { NextResponse } from "next/server";
import { retiredRouteGuard } from "@/lib/auth/retired-route";
import { getAdminClient } from "@/lib/supabase/admin";

export async function POST(req) {
  const retired = retiredRouteGuard("/api/save-purchase");
  if (retired) return retired;

  try {
    const supabase = getAdminClient();
    const { userId, items } = await req.json();

    if (!userId || !items?.length) {
      return NextResponse.json({ error: "Missing userId or items" }, { status: 400 });
    }

    const rows = items.map(item => ({
      user_id: userId,
      item_slug: item.slug,
      item_title: item.title,
      item_price: item.price,
      item_cover: item.cover || null,
    }));

    const { error } = await supabase.from("purchases").insert(rows);

    if (error) {
      console.error("Save purchase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Save purchase error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
