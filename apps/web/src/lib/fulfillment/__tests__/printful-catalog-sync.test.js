import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const readOnlyMigration = (needle) => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
};

// ── schema: two distinct Printful ids per variant, plus a stable product key ──

test("product_variants carries both the sync-variant id (orders) and the catalog variant id (shipping rates)", () => {
  const sql = readOnlyMigration("merch_fulfillment");
  assert.match(sql, /external_variant_id text not null,/);
  assert.match(sql, /catalog_variant_id text,/);
  assert.match(sql, /unique \(product_id, external_variant_id\)/);
});

test("products gains external_product_id as the stable re-sync matching key", () => {
  const sql = readOnlyMigration("merch_fulfillment");
  assert.match(sql, /alter table public\.products\s*\n\s*add column if not exists external_product_id text;/);
  assert.match(sql, /create unique index if not exists products_external_product_id_uidx\s*\n\s*on public\.products \(external_product_id\)\s*\n\s*where external_product_id is not null;/);
});

test("merch_fulfillments and the purchases/purchase_items extensions exist for order tracking", () => {
  const sql = readOnlyMigration("merch_fulfillment");
  assert.match(sql, /create table if not exists public\.merch_fulfillments/);
  assert.match(sql, /check \(status in \('pending','submitted','shipped','delivered','failed','canceled'\)\)/);
  assert.match(sql, /add column if not exists shipping_address jsonb,/);
  assert.match(sql, /add column if not exists shipping_rate_cents integer;/);
  assert.match(sql, /add column if not exists variant_id uuid references public\.product_variants\(id\);/);
});

// ── syncPrintfulCatalog: matches the two real, confirmed Printful id fields ──

test("the sync stores sync_variant.id as external_variant_id and sync_variant.variant_id as catalog_variant_id — not swapped", () => {
  const src = read("src/lib/fulfillment/sync-printful-catalog.js");
  const rowAt = src.indexOf("const variantRows = activeVariants.map((v) => ({");
  assert.ok(rowAt > -1);
  const body = src.slice(rowAt, rowAt + 400);
  assert.match(body, /external_variant_id: String\(v\.id\),/);
  assert.match(body, /catalog_variant_id: v\.variant_id != null \? String\(v\.variant_id\) : null,/);
});

test("the sync is idempotent: matched by external_product_id, and never overwrites an already-set slug on re-sync", () => {
  const src = read("src/lib/fulfillment/sync-printful-catalog.js");
  assert.match(src, /\.eq\("external_product_id", String\(product\.id\)\)/);
  assert.match(src, /const slug = existing\?\.slug \|\| slugify\(product\.name\);/);
  assert.match(src, /\{ onConflict: "external_product_id" \}/);
  assert.match(src, /\{ onConflict: "product_id,external_variant_id" \}/);
});

test("the sync tags every product as merch and skips discontinued variants", () => {
  const src = read("src/lib/fulfillment/sync-printful-catalog.js");
  assert.match(src, /product_type: "merch",/);
  assert.match(src, /v\.availability_status !== "discontinued"/);
});

test("a single product's sync failure is collected, not thrown — one broken Printful product must not abort the whole sync", () => {
  const src = read("src/lib/fulfillment/sync-printful-catalog.js");
  const loopAt = src.indexOf("for (const summaryRow of syncProducts");
  const catchAt = src.indexOf("} catch (err) {", loopAt);
  assert.ok(loopAt > -1 && catchAt > loopAt);
  const body = src.slice(catchAt, catchAt + 300);
  assert.match(body, /summary\.errors\.push\(/);
});

// ── admin sync route: gated, rate-limited, revalidates the storefront ────────

test("the admin sync route requires admin auth and rate-limits before touching Printful", () => {
  const src = read("src/app/api/admin/printful/sync/route.js");
  assert.match(src, /getAdminSessionUser/);
  assert.match(src, /isAdminUser\(user\)/);
  assert.match(src, /checkRateLimit\(/);
  const rlAt = src.indexOf("checkRateLimit(");
  const syncAt = src.indexOf("syncPrintfulCatalog()");
  assert.ok(rlAt > -1 && syncAt > rlAt);
});

test("a successful sync revalidates the storefront so the new merch shows up without waiting out the ISR window", () => {
  const src = read("src/app/api/admin/printful/sync/route.js");
  const syncAt = src.indexOf("const summary = await syncPrintfulCatalog();");
  const revalidateAt = src.indexOf("revalidateStorefront();", syncAt);
  assert.ok(syncAt > -1 && revalidateAt > syncAt);
});

// ── admin dashboard: a real trigger for the sync, with visible feedback ──────

test("the admin dashboard has a Sync Printful Catalog button wired to the sync route", () => {
  const src = read("src/app/admin/page.js");
  assert.match(src, /function SyncPrintfulButton\(\) \{/);
  assert.match(src, /fetch\("\/api\/admin\/printful\/sync", \{ method: "POST" \}\)/);
  assert.match(src, /<SyncPrintfulButton \/>/);
});

// ── /api/printful/products: the synced catalog is primary, not a pass-through ──

test("the merch listing route reads the synced catalog first — a live Printful pass-through item's slug can't resolve in cart/checkout", () => {
  const src = read("src/app/api/printful/products/route.js");
  const fnAt = src.indexOf("export async function GET() {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 400);
  assert.match(body, /const catalog = await merchFromCatalog\(\);/);
  assert.match(body, /if \(catalog\.length > 0\) \{\s*\n\s*return Response\.json\(\{ success: true, products: catalog, source: "catalog" \}\);/);
});

test("the live Printful call only remains as a pre-sync display fallback, clearly labeled as such", () => {
  const src = read("src/app/api/printful/products/route.js");
  assert.match(src, /source: products\.length \? "printful_unsynced" : "none",/);
});
