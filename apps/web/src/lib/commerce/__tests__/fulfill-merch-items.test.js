import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// fulfillPaymentIntent/fulfillCheckoutSession call getAdminClient() directly
// (not dependency-injected — unlike resolve-cart.js's admin param, added
// specifically for testability), so the rest of this file's coverage of
// fulfill-purchase.js is already static-source assertion, not fake-admin
// behavioral testing (see analytics-p0-integrity.test.js). This file follows
// that same established convention for fulfillMerchItemsIfAny, the function
// that actually places the real Printful order — previously nothing did.

test("fulfillMerchItemsIfAny exists and is called from both fulfillment entry points, after purchase_items are recorded", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  assert.match(src, /async function fulfillMerchItemsIfAny\(admin, \{ purchaseId, items, shipping \}\)/);

  const checkoutFnAt = src.indexOf("export async function fulfillCheckoutSession");
  const checkoutBody = src.slice(checkoutFnAt, src.indexOf("export async function fulfillPaymentIntent"));
  assert.match(checkoutBody, /await fulfillMerchItemsIfAny\(admin, \{ purchaseId: purchase\.id, items, shipping: session\.shipping_details \|\| session\.customer_details \}\);/);

  const intentBody = src.slice(src.indexOf("export async function fulfillPaymentIntent"));
  assert.match(intentBody, /await fulfillMerchItemsIfAny\(admin, \{ purchaseId: purchase\.id, items, shipping: paymentIntent\.shipping \}\);/);
});

test("only merch items with a real external_variant_id are sent to the fulfillment provider — a merch line missing it is silently skipped, not sent as a broken order", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function fulfillMerchItemsIfAny(admin");
  const body = src.slice(fnAt, fnAt + 2400);
  assert.match(body, /item\?\.type === "merch" && item\?\.external_variant_id/);
  assert.match(body, /if \(!merchItems\.length\) return;/);
});

test("the FulfillmentPort contract is honored: recipient built from the payment's real shipping details, items carry both variant ids, externalOrderId is the purchase id", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function fulfillMerchItemsIfAny(admin");
  const body = src.slice(fnAt, fnAt + 2400);
  assert.match(body, /getFulfillmentProvider\(\)\.createOrder\(\{/);
  assert.match(body, /catalogVariantId: item\.catalog_variant_id,/);
  assert.match(body, /externalVariantId: item\.external_variant_id,/);
  assert.match(body, /externalOrderId: purchaseId,/);
  // Every FulfillmentPort.createOrder-required recipient field must be sourced
  // from the real Stripe shipping object, never hardcoded or client-supplied.
  for (const field of ["name", "address1", "city", "state", "country", "zip"]) {
    assert.match(body, new RegExp(`${field}:`), `recipient.${field} must be set`);
  }
});

test("a missing shipping address is caught before calling the provider, not left to fail inside it", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function fulfillMerchItemsIfAny(admin");
  const body = src.slice(fnAt, fnAt + 2400);
  const checkAt = body.indexOf('["address1", "city", "state", "country", "zip"].filter((f) => !recipient[f]);');
  const throwAt = body.indexOf("throw new Error(`Missing shipping fields", checkAt);
  const createOrderAt = body.indexOf("getFulfillmentProvider()", checkAt);
  assert.ok(checkAt > -1 && throwAt > checkAt && throwAt < createOrderAt);
});

test("fulfillMerchItemsIfAny never throws — a Printful outage must not block the customer's digital entitlements or purchase record, and the failure is still recorded as a visible merch_fulfillments row", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function fulfillMerchItemsIfAny(admin");
  const closeAt = src.indexOf("\n}\n", fnAt);
  const body = src.slice(fnAt, closeAt > -1 ? closeAt : fnAt + 3000);
  assert.match(body, /\} catch \(err\) \{/);
  assert.match(body, /console\.error\("\[fulfill-purchase\] merch fulfillment failed/);
  assert.match(body, /status: "failed" \}/, "a failed order must still leave a visible, queryable merch_fulfillments row");
  // The catch block's own recovery write must itself be guarded — recording
  // the failure can never become a second, unhandled throw.
  const innerCatchAt = body.indexOf("} catch {", body.indexOf("} catch (err) {"));
  assert.ok(innerCatchAt > -1, "the failure-recording upsert must have its own try/catch");
});

test("a successful order writes merch_fulfillments keyed by purchase_id (idempotent on webhook retry) and records the shipping address actually used", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function fulfillMerchItemsIfAny(admin");
  const body = src.slice(fnAt, fnAt + 2400);
  assert.match(body, /admin\.from\("merch_fulfillments"\)\.upsert\(/);
  assert.match(body, /\{ onConflict: "purchase_id" \}/);
  assert.match(body, /status: "submitted"/);
  assert.match(body, /admin\.from\("purchases"\)\.update\(\{ shipping_address: recipient \}\)\.eq\("id", purchaseId\);/);
});

test("recordPurchaseItems now resolves purchase_items.variant_id from the cart line's variant, so merch orders are traceable back to the exact size/color sold", () => {
  const src = read("src/lib/commerce/fulfill-purchase.js");
  const fnAt = src.indexOf("async function recordPurchaseItems(admin");
  const body = src.slice(fnAt, fnAt + 2400);
  assert.match(body, /variant_id: item\.variant_id \|\| null,/);
});
