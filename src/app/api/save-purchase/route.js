import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  const secret = req.headers.get("x-seed-secret");
  if (!process.env.ADMIN_SEED_SECRET || secret !== process.env.ADMIN_SEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
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