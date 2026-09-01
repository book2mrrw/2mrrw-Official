/**
 * P1.11 / P4 — Purchase → library_items → entitlements → stream gate (logic + optional live DB + HTTP).
 *
 * Live DB:
 *   E2E_SUPABASE_URL=... E2E_SUPABASE_SECRET_KEY=... \
 *   E2E_USER_ID=... E2E_PRODUCT_SLUG=hour-glass-digital \
 *   node scripts/test-library-stream-e2e.mjs
 *
 * HTTP stream (preview/prod or local with session cookie):
 *   E2E_STREAM_BASE_URL=https://... E2E_PRODUCT_SLUG=... E2E_SESSION_COOKIE='guest_session=...' \
 *   node scripts/test-library-stream-e2e.mjs
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
const userId = process.env.E2E_USER_ID;
const productSlug = process.env.E2E_PRODUCT_SLUG;
const streamBase = (process.env.E2E_STREAM_BASE_URL || "").replace(/\/+$/, "");
const sessionCookie = process.env.E2E_SESSION_COOKIE || "";

const hasDb = Boolean(url && key && userId && productSlug);
const hasHttp = Boolean(streamBase && productSlug && sessionCookie);

if (!hasDb && !hasHttp) {
  console.log(
    "library-stream-e2e: logic checks ok (set E2E_* env for live Supabase and/or E2E_STREAM_BASE_URL + E2E_SESSION_COOKIE)"
  );
  process.exit(0);
}

if (hasDb) {
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
}

if (hasHttp) {
  const streamUrl = `${streamBase}/api/library/stream?slug=${encodeURIComponent(productSlug)}&redirect=1`;
  const response = await fetch(streamUrl, {
    method: "GET",
    redirect: "manual",
    headers: {
      Cookie: sessionCookie,
      Accept: "application/json",
    },
  });

  const okStatuses = new Set([200, 302, 307, 308]);
  assert.ok(okStatuses.has(response.status), `stream HTTP ${response.status} for ${streamUrl}`);

  if (response.status === 200) {
    const body = await response.json();
    assert.ok(body?.url, "JSON stream response must include url");
  }

  console.log("library-stream-e2e: HTTP stream check ok", {
    status: response.status,
    productSlug,
  });
}
