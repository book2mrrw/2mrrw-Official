export function getMerchOptions(item, selection = {}) {
  const variants = (Array.isArray(item?.variants) ? item.variants : []).filter(
    (v) => v.id && v.active !== false && v.price != null && Number.isFinite(Number(v.price)) && Number(v.price) >= 0
  );
  const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean))];
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
  const size = selection.size ?? (sizes.length === 1 ? sizes[0] : "");
  const color = selection.color ?? (colors.length === 1 ? colors[0] : "");
  // Never substitute a different variant for an unavailable size/color pair.
  const variant = variants.find((v) =>
    (!sizes.length || v.size === size) && (!colors.length || v.color === color)
  ) || null;
  const price = variant ? Number(variant.price) : variants.length
    ? Math.min(...variants.map((v) => Number(v.price))) : null;
  return { variants, sizes, colors, size, color, variant, price };
}

export function merchCartItem(item, variant) {
  if (!variant) return null;
  const label = [variant.size, variant.color].filter(Boolean).join(" / ");
  return {
    slug: item.slug,
    title: label ? `${item.title} (${label})` : item.title,
    cover: item.cover,
    price: Number(variant.price),
    product_type: "merch",
    variantId: variant.id,
    externalVariantId: variant.externalVariantId,
    catalogVariantId: variant.catalogVariantId,
    size: variant.size || null,
    color: variant.color || null,
  };
}
