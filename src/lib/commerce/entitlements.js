import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

export async function getOwnedSlugs(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("library_items")
    .select("product_id, products(slug)")
    .eq("user_id", userId);

  if (error) throw error;
  return new Set((data || []).map((row) => row.products?.slug).filter(Boolean));
}

export async function userOwnsProduct(userId, productSlug) {
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("slug", productSlug).single();
  if (!product) return false;

  const { data } = await admin
    .from("library_items")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", product.id)
    .maybeSingle();

  return !!data;
}

export async function grantLibraryItems({ userId, purchaseId, slugs, source = "purchase" }) {
  const admin = createAdminClient();
  const { data: products, error: pErr } = await admin.from("products").select("id, slug").in("slug", slugs);
  if (pErr) throw pErr;
  if (!products?.length) return [];

  const rows = products.map((p) => ({
    user_id: userId,
    product_id: p.id,
    purchase_id: purchaseId,
    source,
  }));

  const { data, error } = await admin
    .from("library_items")
    .upsert(rows, { onConflict: "user_id,product_id", ignoreDuplicates: true })
    .select("*, products(slug, title, product_type, cover_url)");

  if (error) throw error;
  return data || [];
}

export async function createAccessToken({ userId, productId, purchaseId, ttlHours = 168 }) {
  const admin = createAdminClient();
  const raw = crypto.randomBytes(32).toString("hex");
  const token_hash = crypto.createHash("sha256").update(raw).digest("hex");
  const expires_at = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const { error } = await admin.from("access_tokens").insert({
    user_id: userId,
    product_id: productId,
    purchase_id: purchaseId,
    token_hash,
    expires_at,
  });

  if (error) throw error;
  return raw;
}

export async function verifyAccessToken(rawToken) {
  const admin = createAdminClient();
  const token_hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const { data, error } = await admin
    .from("access_tokens")
    .select("*, products(*)")
    .eq("token_hash", token_hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data;
}
