import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { syncPrintfulCatalog } from "../sync-printful-catalog.js";

function database({ productError = null, variantError = null } = {}) {
  const writes = [];
  return { writes, from(table) {
    let write = false;
    const query = {
      select() { return this; }, eq() { return this; },
      upsert(rows, options) { write = true; writes.push({ table, rows, options }); return this; },
      maybeSingle() { return Promise.resolve({ data: { id: "product", slug: "stable-shirt" }, error: null }); },
      single() { return Promise.resolve({ data: { id: "product" }, error: productError }); },
      then(resolve) { return Promise.resolve({ error: write ? variantError : null }).then(resolve); },
    };
    return query;
  } };
}

function printful(t) {
  const oldKey = process.env.PRINTFUL_API_KEY;
  process.env.PRINTFUL_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.PRINTFUL_API_KEY; else process.env.PRINTFUL_API_KEY = oldKey; });
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    paths.push(new URL(url).pathname + new URL(url).search);
    return Response.json({ code: 200, result: path === "/store/products"
      ? [{ id: 432602191, name: "Renamed Shirt" }]
      : { sync_product: { id: 432602191, name: "Renamed Shirt", thumbnail_url: "https://example.com/shirt.jpg" },
        sync_variants: [{ id: 5307722670, variant_id: 33938, size: "S", color: "White", retail_price: "40.00", availability_status: "active" }] }
    });
  });
  return paths;
}

test("sync persists real sizes, colors, retail prices and both IDs, preserving the product slug", async (t) => {
  const paths = printful(t);
  const admin = database();
  assert.deepEqual(await syncPrintfulCatalog({ admin }), { products: 1, variants: 1, errors: [] });
  assert.equal(paths[0], "/store/products?limit=100&offset=0");
  assert.equal(admin.writes[0].rows.slug, "stable-shirt");
  assert.equal(admin.writes[0].rows.title, "Renamed Shirt");
  assert.deepEqual(admin.writes[1].rows[0], {
    product_id: "product", external_variant_id: "5307722670", catalog_variant_id: "33938",
    sku: null, size: "S", color: "White", price_cents: 4000, active: true,
  });
});

test("a rejected partial-index upsert reports the exact repair migration", async (t) => {
  printful(t);
  const admin = database({ productError: { code: "42P10", message: "no unique constraint" } });
  const result = await syncPrintfulCatalog({ admin });
  assert.equal(result.products, 0);
  assert.equal(result.variants, 0);
  assert.match(result.errors[0].message, /20260907120000_printful_product_upsert_index.sql/);
  assert.equal(admin.writes.length, 1);
});

test("saving a photo without its variants is not reported as a completed product sync", async (t) => {
  printful(t);
  const result = await syncPrintfulCatalog({ admin: database({ variantError: new Error("variants unavailable") }) });
  assert.equal(result.products, 0);
  assert.equal(result.variants, 0);
  assert.equal(result.errors[0].message, "variants unavailable");
});

test("the follow-up migration replaces the partial index with an inferable unique index", () => {
  const sql = fs.readFileSync("supabase/migrations/20260907120000_printful_product_upsert_index.sql", "utf8");
  assert.match(sql, /drop index if exists public\.products_external_product_id_uidx;/);
  assert.match(sql, /create unique index products_external_product_id_uidx\s+on public\.products \(external_product_id\);/);
});
