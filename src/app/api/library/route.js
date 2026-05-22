import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveMembership,
  getCollectorAccessState,
  getOwnedSlugs,
  grantLibraryItems,
  membershipHasPremiumAccess,
  userOwnsProduct,
} from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";

export async function POST(request) {
  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = String(body.slug || "").trim();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const alreadyOwned = await userOwnsProduct(user.id, slug);
  if (alreadyOwned) {
    return NextResponse.json({ ok: true, slug, alreadyOwned: true });
  }

  const membership = await getActiveMembership(user.id);
  const admin = createAdminClient();
  const ownedSlugs = await getOwnedSlugs(user.id);
  const collector = await getCollectorAccessState(admin, user.id, [...ownedSlugs]);
  const canGrant =
    membershipHasPremiumAccess(membership) || collector.hasCollectorAccess;

  if (!canGrant) {
    return NextResponse.json({ error: "No entitlement to add this track" }, { status: 403 });
  }

  try {
    const items = await grantLibraryItems({
      userId: user.id,
      purchaseId: null,
      slugs: [slug],
      source: "grant",
    });
    return NextResponse.json({ ok: true, slug, items });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Grant failed" }, { status: 500 });
  }
}

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
