"use client";

import { useState } from "react";
import { getMerchOptions, merchCartItem } from "@/lib/commerce/merch-options";

const selectStyle = {
  width: "100%", minWidth: 0, minHeight: 40, background: "#111", color: "#ddd",
  border: "1px solid #333", borderRadius: 6, padding: "8px", fontSize: 12,
};

// Merch must not inherit music entitlement rules or the artwork cache, which
// keys by media URLs and can retain old variants/prices after a catalog sync.
export default function MerchProductCard({ item, addToCart, onCheckoutNow }) {
  const [selection, setSelection] = useState({});
  const { variants, sizes, colors, size, color, variant, price } = getMerchOptions(item, selection);
  const cartItem = merchCartItem(item, variant);
  const unavailable = !variants.length;
  const needsChoice = (sizes.length && !size) || (colors.length && !color);

  return (
    <article className="catalog-adaptive-card" aria-label={item.title} style={{ background: "#0a0a0a", borderRadius: 16, overflow: "hidden", border: "1px solid #1a1a1a" }}>
      {/* Printful supplies the finished product mockup as an ordinary image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.cover || undefined} alt={item.title} loading="lazy" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} />
      <div className="catalog-adaptive-card__meta" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="catalog-adaptive-card__title" style={{ fontWeight: 700 }}>{item.title}</div>
        <div className="catalog-adaptive-card__price" aria-live="polite" style={{ color: "#00ffff", fontWeight: 700 }}>
          {price === null ? "Price unavailable" : `${variant ? "" : "From "}$${price.toFixed(2)}`}
        </div>
        {sizes.length > 0 && (
          <label style={{ fontSize: 12, color: "#ccc" }}>
            Pick Size
            <select aria-label="Pick Size" value={size} onChange={(e) => setSelection((prev) => ({ ...prev, size: e.target.value }))} style={selectStyle}>
              <option value="">Pick Size</option>
              {sizes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        {colors.length > 0 && (
          <label style={{ fontSize: 12, color: "#ccc" }}>
            Pick Color
            <select aria-label="Pick Color" value={color} onChange={(e) => setSelection((prev) => ({ ...prev, color: e.target.value }))} style={selectStyle}>
              <option value="">Pick Color</option>
              {colors.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        {!cartItem && (
          <div role="status" style={{ color: "#aaa", fontSize: 12 }}>
            {unavailable ? "Options are currently unavailable. Please check back soon." : needsChoice ? "Choose your options to add to cart." : "This size and color combination is unavailable."}
          </div>
        )}
        <button className="catalog-adaptive-card__cart" disabled={!cartItem} onClick={() => cartItem && addToCart(cartItem)} style={{ background: "#1a1a1a", color: "white", border: "1px solid #333", cursor: cartItem ? "pointer" : "not-allowed", opacity: cartItem ? 1 : 0.5 }}>
          Add to Cart
        </button>
        {onCheckoutNow && (
          <button className="catalog-adaptive-card__cart" disabled={!cartItem} onClick={() => cartItem && onCheckoutNow(cartItem)} style={{ background: "#00ffff", color: "#000", border: "none", fontWeight: 800, cursor: cartItem ? "pointer" : "not-allowed", opacity: cartItem ? 1 : 0.5 }}>
            Checkout
          </button>
        )}
      </div>
    </article>
  );
}
