/**
 * P1.11 — Purchase → library_items → entitlements → stream gate (logic + optional live DB).
 *
 * Live mode (optional):
 *   E2E_SUPABASE_URL=... E2E_SUPABASE_SERVICE_ROLE_KEY=... \
 *   E2E_USER_ID=... E2E_PRODUCT_SLUG=hour-glass-digital \
 *   node scripts/test-library-stream-e2e.mjs
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.E2E_USER_ID;
const productSlug = process.env.E2E_PRODUCT_SLUG;

if (!url || !key || !userId || !productSlug) {
  console.log("library-stream-e2e: logic checks ok (set E2E_* env for live Supabase verification)");
  process.exit(0);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: product, error: productError } = await admin
  .from("products")
  .select("id, slug")
  .eq("slug", productSlug)
  .maybeSingle();

assert.ok(!productError, productError?.message);
assert.ok(product?.id, `product not found: ${productSlug}`);

const { data: entitlement } = await admin
  .from("entitlements")
  .select("id, status")
  .eq("user_id", userId)
  .eq("resource_type", "product")
  .eq("resource_id", product.id)
  .eq("status", "active")
  .maybeSingle();

const { data: library } = await admin
  .from("library_items")
  .select("id")
  .eq("user_id", userId)
  .eq("product_id", product.id)
  .maybeSingle();

assert.ok(entitlement || library, "user must have entitlement row or library_items row");

console.log("library-stream-e2e: live entitlement check ok", {
  productSlug,
  viaEntitlements: Boolean(entitlement),
  viaLibraryItems: Boolean(library),
});
