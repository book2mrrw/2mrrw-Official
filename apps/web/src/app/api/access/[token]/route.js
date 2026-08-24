import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccessToken } from "@/lib/commerce/entitlements";
import { buildR2Key, createR2SignedGetUrl, R2_PREFIX } from "@/lib/storage/r2";
import { resolveReleaseAccessForProduct } from "@/lib/releases/release-availability-server";

export async function GET(_req, { params }) {
  const raw = (await params).token;
  if (!raw) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const record = await verifyAccessToken(raw);
  if (!record) {
    return NextResponse.json({ error: "Token expired or invalid" }, { status: 403 });
  }

  const product = record.products;
  if (!product?.storage_path) {
    return NextResponse.json({ error: "No asset linked" }, { status: 404 });
  }

  const releaseAccess = await resolveReleaseAccessForProduct({
    slug: product.slug,
    user: { id: record.user_id },
  });
  if (releaseAccess.availability && !releaseAccess.availability.canPlayFull) {
    return NextResponse.json({ error: "Release audio is not available yet" }, { status: 403 });
  }

  const key = buildR2Key(R2_PREFIX.DIGITAL_ASSETS, product.storage_path);
  const url = await createR2SignedGetUrl(key, 900);

  return NextResponse.redirect(url);
}
