import assert from "node:assert/strict";
import test from "node:test";
import { getMerchOptions, merchCartItem } from "../merch-options.js";
import { readMerchCatalog } from "../merch-catalog.js";

const item = { slug: "shirt", title: "Shirt", variants: [
  { id: "s-white", size: "S", color: "White", price: 40, externalVariantId: "5307722670", catalogVariantId: "33938" },
  { id: "m-white", size: "M", color: "White", price: "42.00" },
  { id: "m-black", size: "M", color: "Black", price: 44 },
] };

test("prices and options are available before choosing, but purchase requires a choice", () => {
  const state = getMerchOptions(item);
  assert.deepEqual(state.sizes, ["S", "M"]);
  assert.deepEqual(state.colors, ["White", "Black"]);
  assert.equal(state.price, 40);
  assert.equal(state.variant, null);
});

test("a choice resolves the exact variant and its numeric price", () => {
  const state = getMerchOptions(item, { size: "M", color: "White" });
  assert.equal(state.price, 42);
  assert.equal(merchCartItem(item, state.variant).variantId, "m-white");
  assert.equal(merchCartItem(item, state.variant).price, 42);
});

test("unavailable combinations never fall back to a different item", () => {
  const state = getMerchOptions(item, { size: "S", color: "Black" });
  assert.equal(state.variant, null);
  assert.equal(merchCartItem(item, state.variant), null);
});

test("a single color is retained and a real cart line preserves both Printful identities", () => {
  const state = getMerchOptions({ ...item, variants: item.variants.slice(0, 2) }, { size: "S" });
  assert.equal(state.color, "White");
  const cart = merchCartItem(item, state.variant);
  assert.equal(cart.externalVariantId, "5307722670");
  assert.equal(cart.catalogVariantId, "33938");
  assert.equal(cart.product_type, "merch");
});

test("missing, inactive, and invalid-price variants cannot be added or display a fake zero price", () => {
  for (const variants of [undefined, [], [{ id: "a", price: 40, active: false }], [{ id: "b", price: "invalid" }]]) {
    const state = getMerchOptions({ variants });
    assert.equal(state.variant, null);
    assert.equal(state.price, null);
  }
});

test("refreshing unchanged artwork still uses current options and prices", () => {
  const first = getMerchOptions({ ...item, cover: "/shirt.jpg", variants: [] });
  const refreshed = getMerchOptions({ ...item, cover: "/shirt.jpg" }, { size: "S", color: "White" });
  assert.equal(first.variant, null);
  assert.equal(refreshed.variant.id, "s-white");
  assert.equal(refreshed.price, 40);
});

function catalogDb({ productError = null, variantError = null, variants = [] } = {}) {
  return { from(table) {
    const result = table === "products"
      ? { data: [{ id: "product", slug: "shirt", title: "Shirt", cover_url: "/shirt.jpg" }], error: productError }
      : { data: variants, error: variantError };
    return {
      select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
      range(start, end) { return Promise.resolve({ ...result, data: result.data.slice(start, end + 1) }); },
      then(resolve) { return Promise.resolve(result).then(resolve); },
    };
  } };
}

test("catalog query failures surface instead of quietly removing options", async () => {
  for (const failure of [{ productError: new Error("products unavailable") }, { variantError: new Error("missing variant column") }]) {
    await assert.rejects(() => readMerchCatalog(catalogDb(failure)), /unavailable|missing variant/);
  }
});

test("catalog converts cents and pages every active variant", async () => {
  const variants = Array.from({ length: 501 }, (_, i) => ({ id: String(i), product_id: "product", external_variant_id: `sync-${i}`, catalog_variant_id: `catalog-${i}`, size: "S", color: "White", price_cents: 4000 + i }));
  const [product] = await readMerchCatalog(catalogDb({ variants }));
  assert.equal(product.variants.length, 501);
  assert.equal(product.price, 40);
  assert.equal(product.variants[500].price, 45);
  assert.equal(product.variants[0].externalVariantId, "sync-0");
});
