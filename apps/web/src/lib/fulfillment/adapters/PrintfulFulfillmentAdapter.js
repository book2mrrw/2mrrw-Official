const PRINTFUL_BASE_URL = "https://api.printful.com";

/**
 * The only file in this codebase that knows Printful's actual API shape.
 * Implements the FulfillmentPort contract (getShippingRates, createOrder,
 * getOrderStatus, cancelOrder) — nothing outside this file should ever
 * construct a Printful request or parse a Printful response directly.
 *
 * Two different Printful ids are in play per variant, confirmed against the
 * real API (each endpoint 400s on the other id):
 *   - catalogVariantId — Printful's generic catalog variant id, required by
 *     POST /shipping/rates (rate depends on the blank product, not the design).
 *   - externalVariantId — Printful's "sync variant" id, i.e. THIS store's
 *     specific design+size/color combo, required by POST /orders (this is
 *     what actually gets printed and shipped).
 */
export class PrintfulFulfillmentAdapter {
  #apiKey;
  #fetchImpl;
  #logger;

  constructor({ apiKey, fetchImpl = fetch, logger = null } = {}) {
    if (!apiKey) {
      throw new TypeError("[PrintfulFulfillmentAdapter] apiKey is required");
    }
    this.#apiKey = apiKey;
    this.#fetchImpl = fetchImpl;
    this.#logger = logger;
  }

  async #request(path, { method = "GET", body } = {}) {
    const res = await this.#fetchImpl(`${PRINTFUL_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error?.message || (typeof data?.result === "string" ? data.result : null)
        || `Printful request failed (HTTP ${res.status})`;
      throw new Error(message);
    }
    return data.result;
  }

  async getShippingRates({ recipient, items }) {
    try {
      const result = await this.#request("/shipping/rates", {
        method: "POST",
        body: {
          recipient: mapRecipient(recipient),
          items: items.map((item) => ({
            variant_id: Number(item.catalogVariantId),
            quantity: item.quantity || 1,
          })),
        },
      });
      return {
        rates: (result || []).map((rate) => ({
          service: rate.id,
          name: rate.name,
          rateCents: Math.round(parseFloat(rate.rate) * 100),
          currency: rate.currency,
          minDeliveryDays: rate.minDeliveryDays ?? null,
          maxDeliveryDays: rate.maxDeliveryDays ?? null,
        })),
      };
    } catch (err) {
      this.#logger?.emit?.({ type: "FULFILLMENT_RATE_LOOKUP_FAILED", provider: "printful", message: err.message });
      throw err;
    }
  }

  async createOrder({ recipient, items, externalOrderId }) {
    try {
      const result = await this.#request("/orders", {
        method: "POST",
        body: {
          external_id: externalOrderId,
          recipient: mapRecipient(recipient),
          items: items.map((item) => ({
            sync_variant_id: Number(item.externalVariantId),
            quantity: item.quantity || 1,
          })),
        },
      });
      this.#logger?.emit?.({
        type: "FULFILLMENT_ORDER_CREATED",
        provider: "printful",
        externalOrderId,
        providerOrderId: result?.id,
      });
      return { externalOrderId: String(result.id), status: result.status };
    } catch (err) {
      this.#logger?.emit?.({
        type: "FULFILLMENT_ORDER_CREATE_FAILED",
        provider: "printful",
        externalOrderId,
        message: err.message,
      });
      throw err;
    }
  }

  async getOrderStatus({ externalOrderId }) {
    const result = await this.#request(`/orders/${externalOrderId}`);
    return {
      status: result.status,
      tracking: (result.shipments || []).map((shipment) => ({
        number: shipment.tracking_number || null,
        url: shipment.tracking_url || null,
        carrier: shipment.carrier || null,
      })),
    };
  }

  async cancelOrder({ externalOrderId }) {
    await this.#request(`/orders/${externalOrderId}`, { method: "DELETE" });
    return { canceled: true };
  }
}

function mapRecipient(recipient) {
  return {
    name: recipient.name,
    address1: recipient.address1,
    address2: recipient.address2 || undefined,
    city: recipient.city,
    state_code: recipient.state,
    country_code: recipient.country,
    zip: recipient.zip,
    email: recipient.email || undefined,
    phone: recipient.phone || undefined,
  };
}
