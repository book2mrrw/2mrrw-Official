/** sessionStorage keys for gift reveal → collection handoff */
export const GIFT_OPEN_TAB = "openTab";
export const GIFT_HIGHLIGHT_SLUG = "giftHighlightSlug";
export const GIFT_REVEAL_SEEN_PREFIX = "giftRevealSeen:";

export function giftRevealSeenKey(giftId) {
  return `${GIFT_REVEAL_SEEN_PREFIX}${giftId}`;
}

export function hasSeenGiftReveal(giftId) {
  if (typeof window === "undefined" || !giftId) return false;
  return sessionStorage.getItem(giftRevealSeenKey(giftId)) === "1";
}

export function markGiftRevealSeen(giftId) {
  if (typeof window === "undefined" || !giftId) return;
  sessionStorage.setItem(giftRevealSeenKey(giftId), "1");
}

export function scheduleGiftCollectionHandoff({ slug }) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(GIFT_OPEN_TAB, "mymusic");
  if (slug) sessionStorage.setItem(GIFT_HIGHLIGHT_SLUG, slug);
}

export function consumeGiftHighlightSlug() {
  if (typeof window === "undefined") return null;
  const slug = sessionStorage.getItem(GIFT_HIGHLIGHT_SLUG);
  sessionStorage.removeItem(GIFT_HIGHLIGHT_SLUG);
  return slug || null;
}
