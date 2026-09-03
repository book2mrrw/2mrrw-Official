-- Per-broadcast pay-per-view access. Subscriber and Collector Card holders
-- watch for free (checked against user_entitlements at read time); everyone
-- else pays once for exactly one live_broadcasts row via a name-your-price
-- Stripe Checkout (see LIVE_PPV_PRESET_CENTS in src/lib/live/ppv-pricing.js).
-- A purchase here never grants access to any other broadcast.

create table if not exists public.live_broadcast_purchases (
  id                          uuid        primary key default gen_random_uuid(),
  broadcast_id                uuid        not null references public.live_broadcasts(id) on delete cascade,
  user_id                     uuid        not null references auth.users(id) on delete cascade,
  amount_cents                integer     not null check (amount_cents > 0),
  stripe_checkout_session_id  text        not null unique,
  stripe_payment_intent_id    text,
  status                      text        not null default 'paid' check (status in ('paid','refunded')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- One paid access record per user per broadcast — a retried webhook or a
-- second completed checkout for the same broadcast must never double-charge
-- semantics or create ambiguity about whether access was granted.
create unique index if not exists live_broadcast_purchases_paid_unique_idx
  on public.live_broadcast_purchases (broadcast_id, user_id)
  where (status = 'paid');

create index if not exists live_broadcast_purchases_user_idx
  on public.live_broadcast_purchases (user_id);

alter table public.live_broadcast_purchases enable row level security;

-- Service role writes (webhook fulfillment only). A user may read their own
-- purchase rows; access-gating itself always goes through the server-side
-- resolver, never a client-side read of this table.
drop policy if exists "live_broadcast_purchases_self_read" on public.live_broadcast_purchases;
create policy "live_broadcast_purchases_self_read" on public.live_broadcast_purchases
  for select using (auth.uid() = user_id);

comment on table public.live_broadcast_purchases is
  'One-time pay-per-view purchases scoped to a single live_broadcasts row. Free tiers (subscriber, collector_card) never insert here.';
