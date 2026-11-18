import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";

// next/server has no ESM entry; resolve it like the lyrics route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'), import.meta.url);

// Real checkout, confirm and admin routes against a fake database and Stripe.
const buyer = { id: "user-1", email: "fan@example.com", phone: null };
let requestUser = buyer;
const stripeCalls = { created: [], retrieved: [] };
let paymentIntent = null;
const emails = [];
let db;

function fakeDb({ show }) {
  const state = { show: { ...show }, tickets: [], shows: [], audit: [] };
  const from = (table) => {
    const filters = [];
    let update = null;
    const rows = () => (table === "ticket_purchases" ? state.tickets : [state.show]).filter((row) => filters.every(([col, val]) => row[col] === val));
    const q = {
      select: () => q,
      eq: (col, val) => { filters.push([col, val]); return q; },
      update: (values) => { update = values; return q; },
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: "not found" } }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: (row) => {
        let error = null;
        if (table === "ticket_purchases") {
          if (row.stripe_payment_intent_id && state.tickets.some((t) => t.stripe_payment_intent_id === row.stripe_payment_intent_id)) error = { code: "23505" };
          else state.tickets.push(row);
        } else if (table === "shows_events") state.shows.push(row);
        else state.audit.push(row);
        const result = { data: { id: "new-show", ...row }, error };
        return { select: () => ({ single: async () => result }), then: (resolve) => resolve(result) };
      },
      then: (resolve) => {
        if (update) for (const row of rows()) Object.assign(row, update);
        return resolve({ data: rows(), error: null });
      },
    };
    return q;
  };
  return { state, client: { from } };
}

mock.module("next/server", { namedExports: { NextResponse: { json: (body, init) => Response.json(body, init) } } });
mock.module("@/lib/guest-session", { namedExports: { getRequestUser: async () => requestUser } });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => db.client } });
mock.module("@/lib/server/rate-limit", { namedExports: { checkRateLimit: async () => ({ limited: false, allowed: true }), rateLimitResponse: () => new Response(null, { status: 429 }) } });
mock.module("@/lib/server/email", { namedExports: {
  sendTransactionalEmail: async (message) => { emails.push(message); },
  buildPurchaseConfirmationEmail: () => ({}), buildMembershipWelcomeEmail: () => ({}),
} });
mock.module("@/lib/commerce/stripe", { namedExports: { getStripe: () => ({
  paymentIntents: {
    create: async (params) => { stripeCalls.created.push(params); return { client_secret: "pi_new_secret" }; },
    retrieve: async (id) => { stripeCalls.retrieved.push(id); return paymentIntent; },
  },
}) } });
mock.module("@/lib/auth/admin-api-guard", { namedExports: { getAdminSessionUser: async () => ({ id: "admin-1", isAdmin: true }) } });
mock.module("@/lib/auth/constants", { namedExports: { isAdminUser: (u) => Boolean(u?.isAdmin) } });

const checkout = (await import("../../../app/api/tickets/checkout/route.js")).POST;
const confirm = (await import("../../../app/api/tickets/confirm/route.js")).POST;
const adminShows = await import("../../../app/api/admin/shows/route.js");

const SHOW = { id: "show-1", name: "2Day It Begins", location: "Dallas, TX", event_date: "2026-12-05", event_time: "6:00pm", tickets_available: 100, active: true };
const post = (body) => new Request("https://www.2mrrw.com/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function reset(show) {
  db = fakeDb({ show: { ...SHOW, ...show } });
  requestUser = buyer;
  stripeCalls.created.length = 0;
  stripeCalls.retrieved.length = 0;
  emails.length = 0;
  paymentIntent = null;
}

test("a free show confirms the ticket at once and never touches Stripe", async () => {
  reset({ price_cents: 0 });
  const res = await checkout(post({ showId: "show-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { free: true });
  assert.equal(stripeCalls.created.length, 0);
  assert.equal(db.state.tickets.length, 1);
  assert.deepEqual(
    { status: db.state.tickets[0].status, price: db.state.tickets[0].price_cents, pi: db.state.tickets[0].stripe_payment_intent_id },
    { status: "paid", price: 0, pi: null });
  assert.equal(db.state.show.tickets_available, 99);
  assert.match(emails[0].text, /Total: Free/);

  const again = await checkout(post({ showId: "show-1" }));
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /already have a ticket/);
  assert.equal(db.state.tickets.length, 1);
});

test("a sold-out show refuses free and paid tickets alike", async () => {
  for (const price_cents of [0, 2500]) {
    reset({ price_cents, tickets_available: 0 });
    const res = await checkout(post({ showId: "show-1" }));
    assert.equal(res.status, 400);
    assert.equal(db.state.tickets.length, 0);
    assert.equal(stripeCalls.created.length, 0);
  }
});

test("a paid ticket is recorded the moment the buyer's payment is confirmed with Stripe, once", async () => {
  reset({ price_cents: 2500 });
  const res = await checkout(post({ showId: "show-1" }));
  assert.deepEqual(await res.json(), { clientSecret: "pi_new_secret" });
  assert.equal(stripeCalls.created[0].amount, 2500);
  assert.equal(db.state.tickets.length, 0, "nothing is recorded before payment");

  paymentIntent = {
    id: "pi_123", status: "succeeded", amount: 2500, amount_received: 2500, receipt_email: buyer.email,
    metadata: { ...stripeCalls.created[0].metadata },
  };
  for (let i = 0; i < 2; i += 1) {
    const confirmed = await confirm(post({ paymentIntentId: "pi_123" }));
    assert.equal(confirmed.status, 200);
  }
  assert.equal(db.state.tickets.length, 1, "confirming twice (or the webhook later) records one ticket");
  assert.deepEqual(
    { pi: db.state.tickets[0].stripe_payment_intent_id, price: db.state.tickets[0].price_cents, status: db.state.tickets[0].status },
    { pi: "pi_123", price: 2500, status: "paid" });
  assert.equal(db.state.show.tickets_available, 99);
  assert.match(emails[0].text, /Total: \$25\.00/);
});

test("confirm records nothing for another buyer's, an unfinished or a non-ticket payment", async () => {
  reset({ price_cents: 2500 });
  const metadata = { payment_kind: "ticket", user_id: buyer.id, show_id: "show-1", quantity: "1", price_cents: "2500" };
  for (const [pi, status] of [
    [{ id: "pi_1", status: "succeeded", metadata: { ...metadata, user_id: "someone-else" } }, 403],
    [{ id: "pi_2", status: "requires_payment_method", metadata }, 409],
    [{ id: "pi_3", status: "succeeded", metadata: { ...metadata, payment_kind: "music" } }, 400],
  ]) {
    paymentIntent = pi;
    const res = await confirm(post({ paymentIntentId: pi.id }));
    assert.equal(res.status, status, pi.id);
  }
  assert.equal((await confirm(post({ paymentIntentId: "not-a-pi" }))).status, 400);
  requestUser = null;
  assert.equal((await confirm(post({ paymentIntentId: "pi_1" }))).status, 401);
  assert.equal(db.state.tickets.length, 0);
});

test("the admin can create a free show; an unpicked or below-minimum price is refused", async () => {
  reset({ price_cents: 0 });
  const show = { name: "Free Listening Party", location: "Dallas, TX", event_date: "2026-12-20", event_time: "7:00 PM" };
  const ok = await adminShows.POST(post({ ...show, price_cents: 0 }));
  assert.equal(ok.status, 200);
  assert.equal(db.state.shows[0].price_cents, 0);
  for (const price_cents of [undefined, "", 25]) {
    const res = await adminShows.POST(post({ ...show, price_cents }));
    assert.equal(res.status, 400, String(price_cents));
  }
  assert.equal(db.state.shows.length, 1);
});

test("the admin can schedule a 2MRRW Live event; an unknown event type is refused", async () => {
  reset({ price_cents: 0 });
  const event = { name: "2MRRW Live", location: "Dallas, TX", event_date: "2026-12-20", event_time: "8:00 PM", price_cents: 0 };
  assert.equal((await adminShows.POST(post({ ...event, event_type: "live" }))).status, 200);
  assert.equal(db.state.shows[0].event_type, "live");
  assert.equal((await adminShows.POST(post(event))).status, 200);
  assert.equal(db.state.shows[1].event_type, "show", "a show unless the admin picks 2MRRW Live");
  assert.equal((await adminShows.POST(post({ ...event, event_type: "concert" }))).status, 400);
  const patch = (body) => adminShows.PATCH(new Request("https://www.2mrrw.com/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await patch({ id: "show-1", event_type: "live" })).status, 200);
  assert.equal((await patch({ id: "show-1", event_type: "concert" })).status, 400);
  assert.equal(db.state.shows.length, 2);
});
