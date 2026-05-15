import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userOwnsProduct } from "@/lib/commerce/entitlements";

export async function GET(req) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  const { data, error } = await admin.storage
    .from("digital-assets")
    .createSignedUrl(product.storage_path, 3600);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, expiresIn: 3600 });
}
