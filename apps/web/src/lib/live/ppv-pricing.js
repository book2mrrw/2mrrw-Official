/**
 * Name-your-price presets for live-event pay-per-view access. Shared between
 * the checkout route (server-side validation — never trust a client-sent
 * amount) and the price-picker UI (rendered options).
 */
export const LIVE_PPV_PRESET_CENTS = Object.freeze([
  500, 1000, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
  25000, 40000, 75000, 100000,
]);

export function isAllowedLivePpvAmount(cents) {
  return LIVE_PPV_PRESET_CENTS.includes(Number(cents));
}

export function formatLivePpvAmount(cents) {
  const dollars = Number(cents) / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
