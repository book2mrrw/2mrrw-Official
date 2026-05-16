import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGuestUser } from "@/lib/guest-session";

export async function GET() {
  const user = await getGuestUser();

  if (!user) {
    return NextResponse.json({ items: [], ownedSlugs: [] });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("library_items")
    .select("id, source, granted_at, products (slug, title, product_type, cover_url, storage_path)")
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
    source: row.source,
    gifted: row.source === "gift",
    purchasedAt: row.granted_at,
  }));

  return NextResponse.json({
    items,
    ownedSlugs: items.map((i) => i.slug).filter(Boolean),
  });
}
