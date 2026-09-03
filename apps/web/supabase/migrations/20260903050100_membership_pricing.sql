-- memberships had no price on the row itself — MRR could only be computed by
-- trusting a hardcoded constant (INNER_CIRCLE_PRICE_CENTS) that breaks the
-- moment pricing changes or a second tier is introduced. Captured going
-- forward from the Stripe subscription's own price at webhook time
-- (stripe-entitlements.js upsertMembershipFromSubscription); left null on
-- existing rows until their next status change re-upserts them.
alter table public.memberships
  add column if not exists price_cents integer,
  add column if not exists currency text;
