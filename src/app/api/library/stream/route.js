import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userOwnsProduct } from "@/lib/commerce/entitlements";
import { getGuestUser } from "@/lib/guest-session";
import { buildR2Key, createR2SignedGetUrl, R2_PREFIX } from "@/lib/storage/r2";

export async function GET(req) {
  const slug = req.nextUrl.searchParams.get("slug");
  const redirect = req.nextUrl.searchParams.get("redirect") === "1";
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owns = await userOwnsProduct(user.id, slug);
  if (!owns) {
    return NextResponse.json({ error: "Not in your library" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("storage_path").eq("slug", slug).single();
  if (!product?.storage_path) {
    return NextResponse.json({ error: "No downloadable asset for this item" }, { status: 404 });
  }

  const key = buildR2Key(R2_PREFIX.DIGITAL_ASSETS, product.storage_path);
  const url = await createR2SignedGetUrl(key, 3600);

  if (redirect) {
    return NextResponse.redirect(url);
  }

  return NextResponse.json({ url, expiresIn: 3600 });
}
