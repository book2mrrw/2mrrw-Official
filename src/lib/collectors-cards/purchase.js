const CART_KEY = "2mrrw_cart";

/** Sync with home page cart (localStorage) and open checkout shell. */
export function addCollectorCardToCart(card) {
  if (typeof window === "undefined" || !card?.slug) return false;

  try {
    const raw = window.localStorage.getItem(CART_KEY);
    const cart = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(cart) ? cart : [];

    if (list.some((item) => item.slug === card.slug)) {
      window.location.href = "/?checkout=pending";
      return true;
    }

    list.push({
      title: card.modalTitle || card.title,
      slug: card.slug,
      cover: card.artwork || card.cover,
      price: card.price,
    });
    window.localStorage.setItem(CART_KEY, JSON.stringify(list));
    window.location.href = "/?checkout=pending";
    return true;
  } catch (err) {
    console.warn("[collectors-cards] cart sync failed:", err?.message || err);
    return false;
  }
}
