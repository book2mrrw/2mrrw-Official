-- Tickets and Live PPV moved from a Stripe Checkout Session (redirect off the
-- app to a Stripe-hosted page) to an in-page PaymentIntent + Elements flow —
-- there is no checkout session id to store any more, and fulfillment is now
-- keyed on the PaymentIntent id instead.

alter table if exists public.ticket_purchases
  alter column stripe_session_id drop not null;

create unique index if not exists ticket_purchases_payment_intent_uidx
  on public.ticket_purchases (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table if exists public.live_broadcast_purchases
  alter column stripe_checkout_session_id drop not null;
