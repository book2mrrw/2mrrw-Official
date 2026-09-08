import assert from "node:assert/strict";
import test from "node:test";
import { decodeStripeCartMetadata, encodeStripeCartMetadata } from "../stripe-cart-metadata.js";

test("Printful merch metadata stays within Stripe's 500-character value limit", () => {
  const cover = `https://files.cdn.printful.com/${"very-long-path/".repeat(70)}shirt.jpg`;
  const items = [{
    slug: "2mrrw-t-shirt", title: "2MRRW T-shirt", price: 40, cover, type: "merch",
    variant_id: "variant-db-id", external_variant_id: "5307722670",
    catalog_variant_id: "33938", size: "L", color: "Black",
  }];
  const metadata = encodeStripeCartMetadata(items);
  for (const value of Object.values(metadata)) assert.ok(value.length <= 500);
  assert.equal(metadata.items, undefined);
  assert.deepEqual(decodeStripeCartMetadata(metadata), [{
    slug: "2mrrw-t-shirt", title: "2MRRW T-shirt", price: 40, type: "merch",
    variant_id: "variant-db-id", external_variant_id: "5307722670",
    catalog_variant_id: "33938", size: "L", color: "Black",
  }]);
});

test("multiple cart lines use separate bounded metadata values", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    slug: `shirt-${i}`, title: `Shirt ${i}`, price: 40 + i, type: "merch",
    external_variant_id: `sync-${i}`, catalog_variant_id: `catalog-${i}`, size: "XL", color: "Black",
  }));
  const metadata = encodeStripeCartMetadata(items);
  assert.equal(metadata.cart_count, "12");
  assert.equal(decodeStripeCartMetadata(metadata).length, 12);
  for (const value of Object.values(metadata)) assert.ok(value.length <= 500);
});

test("legacy Stripe metadata remains fulfillable", () => {
  const items = [{ slug: "old-purchase", type: "digital", price: 2.99 }];
  assert.deepEqual(decodeStripeCartMetadata({ items: JSON.stringify(items) }), items);
});

