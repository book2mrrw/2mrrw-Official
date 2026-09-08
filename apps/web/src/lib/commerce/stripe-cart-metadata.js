const MAX_METADATA_VALUE_LENGTH = 500;
const MAX_CART_LINES = 40;

function bounded(value, max = 120) {
  if (value == null) return undefined;
  return String(value).slice(0, max);
}

function compactItem(item) {
  return {
    s: bounded(item.slug),
    n: bounded(item.title, 160),
    p: Number(item.price) || 0,
    t: item.type === "merch" ? "m" : item.type === "audio_visual" ? "a" : "d",
    r: bounded(item.release_id),
    a: bounded(item.access_type),
    x: bounded(item.video_id),
    i: bounded(item.variant_id),
    e: bounded(item.external_variant_id),
    c: bounded(item.catalog_variant_id),
    z: bounded(item.size, 40),
    o: bounded(item.color, 80),
  };
}

function expandItem(item) {
  return {
    ...(item.s ? { slug: item.s } : {}),
    ...(item.n ? { title: item.n } : {}),
    price: Number(item.p) || 0,
    type: item.t === "m" ? "merch" : item.t === "a" ? "audio_visual" : "digital",
    ...(item.r ? { release_id: item.r } : {}),
    ...(item.a ? { access_type: item.a } : {}),
    ...(item.x ? { video_id: item.x } : {}),
    ...(item.i ? { variant_id: item.i } : {}),
    ...(item.e ? { external_variant_id: item.e } : {}),
    ...(item.c ? { catalog_variant_id: item.c } : {}),
    ...(item.z ? { size: item.z } : {}),
    ...(item.o ? { color: item.o } : {}),
  };
}

export function encodeStripeCartMetadata(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Checkout cart is empty");
  if (items.length > MAX_CART_LINES) throw new Error(`Checkout supports up to ${MAX_CART_LINES} items`);
  const metadata = { cart_schema: "v1", cart_count: String(items.length) };
  items.forEach((item, index) => {
    const value = JSON.stringify(compactItem(item));
    if (value.length > MAX_METADATA_VALUE_LENGTH) {
      throw new Error(`Checkout item ${index + 1} exceeds Stripe metadata limits`);
    }
    metadata[`cart_${index}`] = value;
  });
  return metadata;
}

export function decodeStripeCartMetadata(metadata = {}) {
  if (metadata.cart_schema !== "v1") {
    try { return JSON.parse(metadata.items || "[]"); } catch { return []; }
  }
  const count = Math.min(MAX_CART_LINES, Math.max(0, Number.parseInt(metadata.cart_count, 10) || 0));
  const items = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const compact = JSON.parse(metadata[`cart_${index}`] || "null");
      if (compact && typeof compact === "object") items.push(expandItem(compact));
    } catch {
      // A malformed line is ignored; fulfillment remains idempotent for valid lines.
    }
  }
  return items;
}

