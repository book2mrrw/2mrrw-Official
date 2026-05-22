const CART_KEY = "2mrrw_cart";

export function cartLineFromCard(card) {
  if (!card?.slug) return null;
  return {
    title: card.modalTitle || card.title,
    slug: card.slug,
    cover: card.artwork || card.cover,
    price: card.price,
  };
}

/** Create PaymentIntent client secret for a single collector card (same API as cart checkout). */
export async function createCollectorPaymentIntent(cart) {
  const res = await fetch("/api/create-payment-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ cart }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || "Checkout failed.");
  if (!data.clientSecret) throw new Error("No client secret returned.");
  return data.clientSecret;
}

/** Idempotent fulfillment after Payment Element success (webhook backup). */
export async function confirmCollectorPurchase(paymentIntentId) {
  if (!paymentIntentId) return;
  try {
    await fetch("/api/purchase/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ paymentIntentId }),
    });
  } catch {
    /* webhook may still fulfill */
  }
}

/** Sync with home page cart (localStorage) — optional path from other surfaces. */
export function addCollectorCardToCart(card) {
  if (typeof window === "undefined" || !card?.slug) return false;

  try {
    const raw = window.localStorage.getItem(CART_KEY);
    const cart = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(cart) ? cart : [];
    const line = cartLineFromCard(card);
    if (!line) return false;

    if (list.some((item) => item.slug === line.slug)) {
      return true;
    }

    list.push(line);
    window.localStorage.setItem(CART_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.warn("[collectors-cards] cart sync failed:", err?.message || err);
    return false;
  }
}
