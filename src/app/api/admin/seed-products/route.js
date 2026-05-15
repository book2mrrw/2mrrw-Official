import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRODUCT_CATALOG } from "@/lib/commerce/catalog";

export async function POST(req) {
  const secret = req.headers.get("x-seed-secret");
  if (!process.env.ADMIN_SEED_SECRET || secret !== process.env.ADMIN_SEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const rows = PRODUCT_CATALOG.map((p) => ({
    slug: p.slug,
    title: p.title,
    product_type: p.product_type,
    price_cents: p.price_cents,
    cover_url: p.cover_url,
    storage_path: p.storage_path || null,
    preview_path: p.preview_path || null,
    active: true,
  }));

  const { data, error } = await admin
    .from("products")
    .upsert(rows, { onConflict: "slug" })
    .select("slug");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ seeded: data?.length || rows.length, slugs: data?.map((d) => d.slug) });
}
