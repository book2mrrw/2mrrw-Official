import assert from "node:assert/strict";
import test from "node:test";
import { FulfillmentPort } from "@/lib/fulfillment/ports/FulfillmentPort";
import { PrintfulFulfillmentAdapter } from "@/lib/fulfillment/adapters/PrintfulFulfillmentAdapter";

const RECIPIENT = {
  name: "Fan Name",
  address1: "123 Main St",
  city: "Chatsworth",
  state: "CA",
  country: "US",
  zip: "91311",
};

const ITEM = { catalogVariantId: "10779", externalVariantId: "5307718111", quantity: 1 };

function fakeAdapter(overrides = {}) {
  return {
    getShippingRates: async () => ({ rates: [] }),
    createOrder: async () => ({ externalOrderId: "1", status: "pending" }),
    getOrderStatus: async () => ({ status: "pending", tracking: [] }),
    cancelOrder: async () => ({ canceled: true }),
    ...overrides,
  };
}

// ── FulfillmentPort: construction guards ─────────────────────────────────────

test("FulfillmentPort refuses to construct with an adapter missing any required method", () => {
  assert.throws(() => new FulfillmentPort({}), TypeError);
  assert.throws(() => new FulfillmentPort({ getShippingRates: async () => {} }), TypeError);
});

test("FulfillmentPort accepts a fully-implementing fake adapter", () => {
  assert.doesNotThrow(() => new FulfillmentPort(fakeAdapter()));
});

// ── FulfillmentPort: per-method input validation ─────────────────────────────

test("getShippingRates requires a valid recipient and a non-empty items array", async () => {
  const port = new FulfillmentPort(fakeAdapter());
  await assert.rejects(() => port.getShippingRates({ recipient: null, items: [ITEM] }), TypeError);
  await assert.rejects(() => port.getShippingRates({ recipient: RECIPIENT, items: [] }), TypeError);
  await assert.rejects(() => port.getShippingRates({ recipient: { name: "x" }, items: [ITEM] }), TypeError,
    "must validate every required recipient field, not just presence of the object");
  await assert.doesNotReject(() => port.getShippingRates({ recipient: RECIPIENT, items: [ITEM] }));
});

test("createOrder additionally requires an externalOrderId", async () => {
  const port = new FulfillmentPort(fakeAdapter());
  await assert.rejects(() => port.createOrder({ recipient: RECIPIENT, items: [ITEM], externalOrderId: null }), TypeError);
  await assert.doesNotReject(() => port.createOrder({ recipient: RECIPIENT, items: [ITEM], externalOrderId: "purchase-1" }));
});

test("getOrderStatus and cancelOrder both require externalOrderId", async () => {
  const port = new FulfillmentPort(fakeAdapter());
  await assert.rejects(() => port.getOrderStatus({}), TypeError);
  await assert.rejects(() => port.cancelOrder({}), TypeError);
});

test("FulfillmentPort delegates straight through to the adapter without altering the result", async () => {
  const port = new FulfillmentPort(fakeAdapter({
    getShippingRates: async () => ({ rates: [{ service: "STANDARD", rateCents: 879 }] }),
  }));
  const result = await port.getShippingRates({ recipient: RECIPIENT, items: [ITEM] });
  assert.deepEqual(result, { rates: [{ service: "STANDARD", rateCents: 879 }] });
});

// ── PrintfulFulfillmentAdapter: construction guard ───────────────────────────

test("PrintfulFulfillmentAdapter refuses to construct without an apiKey", () => {
  assert.throws(() => new PrintfulFulfillmentAdapter({}), TypeError);
  assert.doesNotThrow(() => new PrintfulFulfillmentAdapter({ apiKey: "test-key" }));
});

// ── PrintfulFulfillmentAdapter: request shape per real, confirmed API behavior ──

function fakeFetch(responseBody, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => responseBody,
    };
  };
  impl.calls = calls;
  return impl;
}

test("getShippingRates sends the catalog variant_id (not the sync/external id) — confirmed against the real Printful API, which 400s on the other id", async () => {
  const fetchImpl = fakeFetch({
    code: 200,
    result: [{ id: "STANDARD", name: "Flat Rate", rate: "8.79", currency: "USD", minDeliveryDays: 4, maxDeliveryDays: 6 }],
  });
  const adapter = new PrintfulFulfillmentAdapter({ apiKey: "test-key", fetchImpl });
  const result = await adapter.getShippingRates({ recipient: RECIPIENT, items: [ITEM] });

  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /\/shipping\/rates$/);
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.items[0].variant_id, 10779);
  assert.equal(sentBody.items[0].quantity, 1);
  assert.equal(sentBody.recipient.state_code, "CA");
  assert.equal(sentBody.recipient.country_code, "US");

  assert.deepEqual(result.rates, [{
    service: "STANDARD", name: "Flat Rate", rateCents: 879, currency: "USD",
    minDeliveryDays: 4, maxDeliveryDays: 6,
  }]);
});

test("createOrder sends the sync_variant_id (not the catalog variant_id) — this is what actually gets printed and shipped", async () => {
  const fetchImpl = fakeFetch({ code: 200, result: { id: 999, status: "pending" } });
  const adapter = new PrintfulFulfillmentAdapter({ apiKey: "test-key", fetchImpl });
  const result = await adapter.createOrder({ recipient: RECIPIENT, items: [ITEM], externalOrderId: "purchase-1" });

  assert.match(fetchImpl.calls[0].url, /\/orders$/);
  const sentBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(sentBody.external_id, "purchase-1");
  assert.equal(sentBody.items[0].sync_variant_id, 5307718111);
  assert.ok(!("variant_id" in sentBody.items[0]),
    "order line items must never send the catalog variant_id — that would order the blank product, not this store's design");

  assert.deepEqual(result, { externalOrderId: "999", status: "pending" });
});

test("getOrderStatus maps Printful's shipments array to a flat tracking list", async () => {
  const fetchImpl = fakeFetch({
    code: 200,
    result: { status: "fulfilled", shipments: [{ tracking_number: "1Z999", tracking_url: "https://track.example/1Z999", carrier: "UPS" }] },
  });
  const adapter = new PrintfulFulfillmentAdapter({ apiKey: "test-key", fetchImpl });
  const result = await adapter.getOrderStatus({ externalOrderId: "999" });
  assert.deepEqual(result, {
    status: "fulfilled",
    tracking: [{ number: "1Z999", url: "https://track.example/1Z999", carrier: "UPS" }],
  });
});

test("a non-ok Printful response surfaces the API's own error message and logs a structured failure event", async () => {
  const fetchImpl = fakeFetch(
    { code: 400, error: { message: "Missing item variant_id" } },
    { ok: false, status: 400 }
  );
  const events = [];
  const adapter = new PrintfulFulfillmentAdapter({
    apiKey: "test-key",
    fetchImpl,
    logger: { emit: (e) => events.push(e) },
  });
  await assert.rejects(
    () => adapter.getShippingRates({ recipient: RECIPIENT, items: [ITEM] }),
    /Missing item variant_id/
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "FULFILLMENT_RATE_LOOKUP_FAILED");
});

// ── get-fulfillment-provider.js: single centralized factory ─────────────────

test("getFulfillmentProvider returns a singleton FulfillmentPort backed by PrintfulFulfillmentAdapter", async () => {
  process.env.PRINTFUL_API_KEY = "test-key-for-factory";
  const { getFulfillmentProvider, __resetFulfillmentProviderForTests } = await import("@/lib/fulfillment/get-fulfillment-provider");
  __resetFulfillmentProviderForTests();
  const a = getFulfillmentProvider();
  const b = getFulfillmentProvider();
  assert.ok(a instanceof FulfillmentPort);
  assert.equal(a, b, "must return the same singleton instance on repeated calls");
});
