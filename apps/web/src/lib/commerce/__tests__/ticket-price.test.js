import assert from "node:assert/strict";
import test from "node:test";

import { formatTicketPrice, MIN_PAID_TICKET_CENTS, ticketPriceError } from "../ticket-price.js";

test("Free and any price from the $0.50 card minimum up are valid ticket prices", () => {
  for (const cents of [0, "0", MIN_PAID_TICKET_CENTS, 2500, "2500", 350000]) assert.equal(ticketPriceError(cents), null, String(cents));
});

test("an unpicked, negative, fractional or below-minimum price is rejected — never read as free", () => {
  for (const cents of ["", null, undefined, -1, 12.5, "abc"]) assert.match(ticketPriceError(cents), /Free or a whole number/, String(cents));
  for (const cents of [1, 49]) assert.match(ticketPriceError(cents), /at least \$0\.50/, String(cents));
});

test("a free ticket reads Free, a paid one reads in dollars (also from a dollar price times 100)", () => {
  assert.equal(formatTicketPrice(0), "Free");
  assert.equal(formatTicketPrice(null), "Free");
  assert.equal(formatTicketPrice(2500), "$25.00");
  assert.equal(formatTicketPrice(49.99 * 100), "$49.99");
  assert.equal(formatTicketPrice(0.1 * 3 * 100), "$0.30");
});
