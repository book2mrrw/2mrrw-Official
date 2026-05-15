import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ items: [], ownedSlugs: [] });
  }

  const { data, error } = await supabase
    .from("library_items")
    .select("id, granted_at, products (slug, title, product_type, cover_url, storage_path)")
    .eq("user_id", user.id)
    .order("granted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data || []).map((row) => ({
    slug: row.products?.slug,
    title: row.products?.title,
    product_type: row.products?.product_type,
    cover: row.products?.cover_url,
    purchasedAt: row.granted_at,
  }));

  return NextResponse.json({
    items,
    ownedSlugs: items.map((i) => i.slug).filter(Boolean),
  });
}
