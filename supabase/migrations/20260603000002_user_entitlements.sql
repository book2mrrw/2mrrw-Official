-- Per-user entitlement flags (vault_access, subscriber, collector_card).
-- Complements granular public.entitlements ledger; service-role writes from webhooks/admin.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vault_access boolean not null default false,
  subscriber boolean not null default false,
  collector_card boolean not null default false,
  vault_source text,
  subscriber_source text,
  collector_source text,
  collector_card_id uuid references public.collector_cards (id) on delete set null,
  stripe_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_entitlements_subscriber_idx
  on public.user_entitlements (subscriber)
  where subscriber = true;

create index if not exists user_entitlements_vault_idx
  on public.user_entitlements (vault_access)
  where vault_access = true;

create index if not exists user_entitlements_collector_idx
  on public.user_entitlements (collector_card)
  where collector_card = true;

alter table public.user_entitlements enable row level security;

drop policy if exists "user_entitlements_select_own" on public.user_entitlements;
create policy "user_entitlements_select_own"
  on public.user_entitlements
  for select
  using (auth.uid() = user_id);

drop trigger if exists user_entitlements_updated_at on public.user_entitlements;
create trigger user_entitlements_updated_at
  before update on public.user_entitlements
  for each row execute function public.set_updated_at();

comment on table public.user_entitlements is 'Canonical user-level access flags; NFC physical tap is separate from digital_access grants.';
