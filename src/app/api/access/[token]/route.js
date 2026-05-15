import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAccessToken } from "@/lib/commerce/entitlements";

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

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("digital-assets")
    .createSignedUrl(product.storage_path, 900);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
