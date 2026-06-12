import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
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
import { catalogCoverUrl } from "@/lib/media-urls";

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function POST(request) {
  const user = await getGuestUser();
  if (!user) {
    return applyMediaCors(request, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return applyMediaCors(request, NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const slug = String(body.slug || "").trim();
  if (!slug) {
    return applyMediaCors(request, NextResponse.json({ error: "slug is required" }, { status: 400 }));
  }

  const alreadyOwned = await userOwnsProduct(user.id, slug);
  if (alreadyOwned) {
    return applyMediaCors(
      request,
      NextResponse.json({ ok: true, slug, alreadyOwned: true })
    );
  }

  const membership = await getActiveMembership(user.id);
  const admin = createAdminClient();
  const ownedSlugs = await getOwnedSlugs(user.id);
  const collector = await getCollectorAccessState(admin, user.id, [...ownedSlugs]);
  const canGrant =
    membershipHasPremiumAccess(membership) || collector.hasCollectorAccess;

  if (!canGrant) {
    return applyMediaCors(
      request,
      NextResponse.json({ error: "No entitlement to add this track" }, { status: 403 })
    );
  }

  try {
    const items = await grantLibraryItems({
      userId: user.id,
      purchaseId: null,
      slugs: [slug],
      source: "grant",
    });
    return applyMediaCors(request, NextResponse.json({ ok: true, slug, items }));
  } catch (err) {
    return applyMediaCors(
      request,
      NextResponse.json({ error: err.message || "Grant failed" }, { status: 500 })
    );
  }
}

export async function GET(req) {
  const user = await getGuestUser();

  if (!user) {
    return applyMediaCors(req, NextResponse.json({ items: [], ownedSlugs: [] }));
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("library_items")
    .select("id, source, granted_at, products (slug, title, product_type, cover_url, storage_path)")
    .eq("user_id", user.id)
    .order("granted_at", { ascending: false });

  if (error) {
    return applyMediaCors(req, NextResponse.json({ error: error.message }, { status: 500 }));
  }

  const items = (data || []).map((row) => {
    const rawCover = row.products?.cover_url;
    const cover = rawCover
      ? /^https?:\/\//i.test(String(rawCover))
        ? rawCover
        : catalogCoverUrl(String(rawCover).replace(/^\//, ""))
      : null;

    return {
    slug: row.products?.slug,
    title: row.products?.title,
    product_type: row.products?.product_type,
    cover,
    source: row.source,
    gifted: row.source === "gift",
    purchasedAt: row.granted_at,
  };
  });

  return applyMediaCors(
    req,
    NextResponse.json({
      items,
      ownedSlugs: items.map((i) => i.slug).filter(Boolean),
    })
  );
}
