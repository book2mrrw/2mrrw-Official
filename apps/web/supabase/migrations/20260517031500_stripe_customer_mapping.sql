-- Canonical platform user -> Stripe Customer mapping.
-- Stripe remains the payment vault; this table stores only non-sensitive references.

create table if not exists public.stripe_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_customers_customer_id_idx
  on public.stripe_customers (stripe_customer_id);

drop trigger if exists stripe_customers_updated_at on public.stripe_customers;
create trigger stripe_customers_updated_at before update on public.stripe_customers
  for each row execute function public.set_updated_at();

alter table public.stripe_customers enable row level security;

drop policy if exists "stripe_customers_select_own" on public.stripe_customers;
create policy "stripe_customers_select_own"
  on public.stripe_customers
  for select
  using (auth.uid() = user_id);
