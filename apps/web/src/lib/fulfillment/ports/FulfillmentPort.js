/**
 * Stable, provider-agnostic surface every checkout/webhook route calls for
 * physical-goods fulfillment. Mirrors the ports/adapters shape already used
 * in src/lib/playback-core/{ports,adapters}/: the port validates its own
 * inputs and delegates straight through to a constructor-injected adapter —
 * it never imports a specific provider (Printful or otherwise) itself.
 * Swapping providers later means writing a new adapter that implements these
 * same four methods and changing the one factory in get-fulfillment-provider.js
 * — nothing here, and nothing that calls this port, has to change.
 *
 * @typedef {Object} FulfillmentRecipient
 * @property {string} name
 * @property {string} address1
 * @property {string} [address2]
 * @property {string} city
 * @property {string} state
 * @property {string} country
 * @property {string} zip
 * @property {string} [email]
 * @property {string} [phone]
 *
 * @typedef {Object} FulfillmentLineItem
 * @property {string} catalogVariantId  Provider's generic catalog variant id — required for getShippingRates.
 * @property {string} externalVariantId Provider's store-specific (synced) variant id — required for createOrder.
 * @property {number} quantity
 */
export class FulfillmentPort {
  #adapter;
  #logger;

  constructor(adapter, logger = null) {
    const required = ["getShippingRates", "createOrder", "getOrderStatus", "cancelOrder"];
    const missing = required.filter((method) => typeof adapter?.[method] !== "function");
    if (missing.length) {
      throw new TypeError(
        `[FulfillmentPort] adapter is missing required method(s): ${missing.join(", ")}`
      );
    }
    this.#adapter = adapter;
    this.#logger = logger;
  }

  /**
   * @param {{ recipient: FulfillmentRecipient, items: FulfillmentLineItem[] }} params
   * @returns {Promise<{ rates: Array<{ service, name, rateCents, currency, minDeliveryDays, maxDeliveryDays }> }>}
   */
  async getShippingRates({ recipient, items }) {
    assertRecipient(recipient, "getShippingRates");
    assertItems(items, "getShippingRates");
    return this.#adapter.getShippingRates({ recipient, items });
  }

  /**
   * @param {{ recipient: FulfillmentRecipient, items: FulfillmentLineItem[], externalOrderId: string }} params
   * @returns {Promise<{ externalOrderId: string, status: string }>}
   */
  async createOrder({ recipient, items, externalOrderId }) {
    assertRecipient(recipient, "createOrder");
    assertItems(items, "createOrder");
    if (!externalOrderId) {
      throw new TypeError("[FulfillmentPort.createOrder] externalOrderId is required");
    }
    return this.#adapter.createOrder({ recipient, items, externalOrderId });
  }

  /**
   * @param {{ externalOrderId: string }} params
   * @returns {Promise<{ status: string, tracking: Array<{ number, url, carrier }> }>}
   */
  async getOrderStatus({ externalOrderId }) {
    if (!externalOrderId) {
      throw new TypeError("[FulfillmentPort.getOrderStatus] externalOrderId is required");
    }
    return this.#adapter.getOrderStatus({ externalOrderId });
  }

  /**
   * @param {{ externalOrderId: string }} params
   * @returns {Promise<{ canceled: boolean }>}
   */
  async cancelOrder({ externalOrderId }) {
    if (!externalOrderId) {
      throw new TypeError("[FulfillmentPort.cancelOrder] externalOrderId is required");
    }
    return this.#adapter.cancelOrder({ externalOrderId });
  }
}

function assertRecipient(recipient, methodName) {
  if (!recipient || typeof recipient !== "object") {
    throw new TypeError(`[FulfillmentPort.${methodName}] recipient is required`);
  }
  for (const field of ["name", "address1", "city", "state", "country", "zip"]) {
    if (!recipient[field]) {
      throw new TypeError(`[FulfillmentPort.${methodName}] recipient.${field} is required`);
    }
  }
}

function assertItems(items, methodName) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError(`[FulfillmentPort.${methodName}] items must be a non-empty array`);
  }
}
