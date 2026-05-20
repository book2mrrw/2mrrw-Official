-- Commerce extensions for release-linked pricing and gift purchases (additive).

alter table public.products
  add column if not exists gifting_enabled boolean not null default false;

comment on column public.products.gifting_enabled is 'Mirrors control-system release gifting_enabled for checkout UX.';

-- Fan purchase-to-gift ledger (distinct from admin gift_links).
create table if not exists public.gift_transactions (
  id uuid primary key default gen_random_uuid(),
  purchaser_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_email text not null,
  product_id uuid not null references public.products (id) on delete restrict,
  stripe_payment_intent_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'refunded')),
  redeem_token_hash text unique,
  redeemed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gift_transactions_purchaser_idx on public.gift_transactions (purchaser_user_id);
create index if not exists gift_transactions_product_idx on public.gift_transactions (product_id);
create index if not exists gift_transactions_recipient_email_idx on public.gift_transactions (lower(recipient_email));

alter table public.gift_transactions enable row level security;

drop policy if exists "gift_transactions_select_own" on public.gift_transactions;
create policy "gift_transactions_select_own" on public.gift_transactions
  for select using (auth.uid() = purchaser_user_id);

drop trigger if exists gift_transactions_updated_at on public.gift_transactions;
create trigger gift_transactions_updated_at before update on public.gift_transactions
  for each row execute function public.set_updated_at();
