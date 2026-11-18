/**
 * Ticket price rules, safe for the browser and the server alike. Free shows
 * never touch Stripe (it cannot charge $0); a paid ticket costs at least
 * Stripe's $0.50 minimum.
 */

export const MIN_PAID_TICKET_CENTS = 50;

/** Why `cents` is not a valid ticket price, or null when it is. */
export function ticketPriceError(cents) {
  const value = Number(cents);
  if (cents === null || cents === undefined || cents === "" || !Number.isInteger(value) || value < 0) {
    return "Ticket price must be Free or a whole number of cents";
  }
  if (value > 0 && value < MIN_PAID_TICKET_CENTS) {
    return "A paid ticket must be at least $0.50 (the card minimum). Choose Free for a free show";
  }
  return null;
}

/** "Free", or the price in dollars. */
export function formatTicketPrice(cents) {
  const value = Math.round(Number(cents) || 0);
  return value > 0 ? `$${(value / 100).toFixed(2)}` : "Free";
}
