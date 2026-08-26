import { NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";

const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function POST(req) {
  try {
    const gate = await requireAdminActor(); // human administrator only
    if (!gate.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { title = "Gift from 2MRRW", slugs, expiresAt = null, maxRedemptions = null } = await req.json();
    if (!Array.isArray(slugs) || slugs.length === 0) {
      return NextResponse.json({ error: "slugs required" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: products, error: productError } = await admin
      .from("products")
      .select("id, slug")
      .in("slug", slugs);
    if (productError) throw productError;
    if (!products?.length) {
      return NextResponse.json({ error: "No matching products" }, { status: 400 });
    }

    const raw = crypto.randomBytes(24).toString("hex");
    const { data: link, error: linkError } = await admin
      .from("gift_links")
      .insert({
        title,
        token_hash: hashToken(raw),
        expires_at: expiresAt,
        max_redemptions: maxRedemptions,
        metadata: { slugs },
      })
      .select("id, title")
      .single();
    if (linkError) throw linkError;

    const rows = products.map((p) => ({ gift_link_id: link.id, product_id: p.id }));
    const { error: itemError } = await admin.from("gift_link_items").insert(rows);
    if (itemError) throw itemError;

    return NextResponse.json({
      id: link.id,
      title: link.title,
      token: raw,
      url: `${siteUrl()}/gift/${raw}`,
      slugs: products.map((p) => p.slug),
    });
  } catch (err) {
    console.error("gift create error:", err);
    return NextResponse.json({ error: err.message || "Gift creation failed" }, { status: 500 });
  }
}
