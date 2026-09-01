export function isPhysicalLine(line) {
  const slug = String(line.slug || "");
  if (slug === "vault-pass") return false;
  return line.product_type === "merch" ||
    line.product_type === "vault" ||
    line.product_type === "bundle" ||
    line.product_type === "vinyl" ||
    line.source === "printful" ||
    slug.startsWith("exc-card") ||
    slug.startsWith("exc-bundle") ||
    slug.includes("vinyl") ||
    slug.includes("physical");
}

export function isCollectorLine(line) {
  const slug = String(line.slug || "");
  return slug.startsWith("exc-card") || slug.startsWith("exc-bundle");
}

export function mapResolvedCartItems(lines) {
  return lines.map((line) => ({
    slug: line.slug,
    title: line.title,
    price: line.price_cents / 100,
    total: (line.price_cents * (line.quantity || 1)) / 100,
    cover: line.cover_url,
    type: line.product_type === "merch" ? "merch" : isPhysicalLine(line) ? "physical" : "digital",
    product_type: line.product_type,
    variant_id: line.variant_id || null,
    quantity: line.quantity || 1,
    source: line.source || null,
    physical: isPhysicalLine(line),
    collector: isCollectorLine(line),
    sku: line.slug,
  }));
}
