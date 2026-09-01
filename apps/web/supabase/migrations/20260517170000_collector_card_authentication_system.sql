-- Collector card registry and authentication layer.
-- Raw NFC/tap secrets are generated for manufacturing output only.
-- public.collector_cards.hidden_secure_id stores a SHA-256 digest used by service-role APIs.

create table if not exists public.collector_cards (
  id uuid primary key default gen_random_uuid(),
  release_title text not null,
  visible_serial text not null,
  hidden_secure_id text not null,
  edition_size integer not null check (edition_size > 0),
  claimed boolean not null default false,
  claimed_by_user_id uuid references auth.users (id) on delete set null,
  claim_timestamp timestamptz,
  verification_status text not null default 'minted' check (verification_status in ('minted', 'active', 'claimed', 'verified', 'revoked', 'lost', 'retired')),
  access_tier text not null default 'collector' check (access_tier in ('collector', 'verified_collector', 'founder_collector', 'vault_collector', 'artist_proof')),
  product_slug text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint collector_cards_hidden_secure_id_key unique (hidden_secure_id),
  constraint collector_cards_hidden_secure_id_sha256_check check (hidden_secure_id ~ '^[a-f0-9]{64}$'),
  constraint collector_cards_visible_serial_key unique (visible_serial),
  constraint collector_cards_claim_consistency check (
    (claimed = false and claimed_by_user_id is null and claim_timestamp is null)
    or
    (claimed = true and claimed_by_user_id is not null and claim_timestamp is not null)
  )
);

-- Extend early drafts of this table without breaking existing data.
alter table public.collector_cards add column if not exists release_title text;
alter table public.collector_cards add column if not exists edition_size integer;
alter table public.collector_cards add column if not exists claim_timestamp timestamptz;
alter table public.collector_cards add column if not exists verification_status text not null default 'minted';
alter table public.collector_cards add column if not exists access_tier text not null default 'collector';
alter table public.collector_cards add column if not exists product_slug text;
alter table public.collector_cards add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.collector_cards add column if not exists revoked_at timestamptz;
alter table public.collector_cards add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_cards'
      and column_name = 'release_name'
  ) then
    execute 'update public.collector_cards set release_title = coalesce(release_title, release_name)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_cards'
      and column_name = 'collector_tier'
  ) then
    execute 'update public.collector_cards set access_tier = coalesce(nullif(access_tier, ''''), collector_tier)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_cards'
      and column_name = 'status'
  ) then
    execute 'update public.collector_cards set verification_status = coalesce(nullif(verification_status, ''''), status)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'collector_cards'
      and column_name = 'activated_at'
  ) then
    execute 'update public.collector_cards set claim_timestamp = coalesce(claim_timestamp, activated_at) where claimed = true';
  end if;
end $$;

update public.collector_cards
set edition_size = case
  when visible_serial like 'T.B.H // %/100' then 100
  when visible_serial like 'A.D // %/150' then 150
  when visible_serial like 'LHZV1 // %/300' then 300
  else edition_size
end
where edition_size is null;

alter table public.collector_cards alter column release_title set not null;
alter table public.collector_cards alter column edition_size set not null;
alter table public.collector_cards drop constraint if exists collector_cards_hidden_secure_id_sha256_check;
alter table public.collector_cards add constraint collector_cards_hidden_secure_id_sha256_check check (hidden_secure_id ~ '^[a-f0-9]{64}$');
alter table public.collector_cards drop constraint if exists collector_cards_edition_size_check;
alter table public.collector_cards add constraint collector_cards_edition_size_check check (edition_size > 0);
alter table public.collector_cards drop constraint if exists collector_cards_verification_status_check;
alter table public.collector_cards add constraint collector_cards_verification_status_check check (verification_status in ('minted', 'active', 'claimed', 'verified', 'revoked', 'lost', 'retired'));
alter table public.collector_cards drop constraint if exists collector_cards_access_tier_check;
alter table public.collector_cards add constraint collector_cards_access_tier_check check (access_tier in ('collector', 'verified_collector', 'founder_collector', 'vault_collector', 'artist_proof'));
alter table public.collector_cards drop constraint if exists collector_cards_claim_consistency;
alter table public.collector_cards add constraint collector_cards_claim_consistency check (
  (claimed = false and claimed_by_user_id is null and claim_timestamp is null)
  or
  (claimed = true and claimed_by_user_id is not null and claim_timestamp is not null)
);

create index if not exists collector_cards_claimed_user_idx
  on public.collector_cards (claimed_by_user_id, claim_timestamp desc)
  where claimed_by_user_id is not null;

create index if not exists collector_cards_release_idx
  on public.collector_cards (release_title, visible_serial);

create index if not exists collector_cards_verification_idx
  on public.collector_cards (verification_status, claimed);

create index if not exists collector_cards_product_slug_idx
  on public.collector_cards (product_slug)
  where product_slug is not null;

drop trigger if exists collector_cards_updated_at on public.collector_cards;
create trigger collector_cards_updated_at
  before update on public.collector_cards
  for each row execute function public.set_updated_at();

alter table public.collector_cards enable row level security;

drop policy if exists "collector_cards_select_claimed_own" on public.collector_cards;
-- No public select policy is intentionally defined for collector_cards.
-- Service-role APIs expose safe derived fields and never hidden_secure_id.

create table if not exists public.collector_claims (
  id uuid primary key default gen_random_uuid(),
  collector_card_id uuid not null references public.collector_cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_timestamp timestamptz not null default now(),
  device_info jsonb not null default '{}'::jsonb,
  ip_hash text,
  status text not null default 'claimed' check (status in ('pending', 'claimed', 'duplicate', 'rejected', 'revoked')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists collector_claims_user_idx
  on public.collector_claims (user_id, claim_timestamp desc);

create index if not exists collector_claims_card_idx
  on public.collector_claims (collector_card_id, claim_timestamp desc);

create index if not exists collector_claims_ip_hash_idx
  on public.collector_claims (ip_hash, claim_timestamp desc)
  where ip_hash is not null;

alter table public.collector_claims enable row level security;

drop policy if exists "collector_claims_select_own" on public.collector_claims;
create policy "collector_claims_select_own"
  on public.collector_claims
  for select
  using (auth.uid() = user_id);

create table if not exists public.collector_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  collector_card_id uuid not null references public.collector_cards (id) on delete cascade,
  streaming_access boolean not null default true,
  vault_access boolean not null default true,
  livestream_access boolean not null default true,
  collector_status text not null default 'verified_collector' check (collector_status in ('collector', 'verified_collector', 'founder_collector', 'vault_collector', 'revoked')),
  perks_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, collector_card_id)
);

create index if not exists collector_access_user_active_idx
  on public.collector_access (user_id, updated_at desc)
  where revoked_at is null and collector_status <> 'revoked';

create index if not exists collector_access_card_idx
  on public.collector_access (collector_card_id);

drop trigger if exists collector_access_updated_at on public.collector_access;
create trigger collector_access_updated_at
  before update on public.collector_access
  for each row execute function public.set_updated_at();

alter table public.collector_access enable row level security;

drop policy if exists "collector_access_select_own" on public.collector_access;
create policy "collector_access_select_own"
  on public.collector_access
  for select
  using (auth.uid() = user_id);

create table if not exists public.collector_activity_logs (
  id uuid primary key default gen_random_uuid(),
  collector_card_id uuid references public.collector_cards (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in ('scan', 'claim', 'verification_attempt', 'access_grant', 'duplicate_scan', 'suspicious_activity', 'revoked_session')),
  status text not null default 'recorded' check (status in ('recorded', 'allowed', 'blocked', 'flagged', 'failed')),
  device_info jsonb not null default '{}'::jsonb,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists collector_activity_card_idx
  on public.collector_activity_logs (collector_card_id, created_at desc);

create index if not exists collector_activity_user_idx
  on public.collector_activity_logs (user_id, created_at desc)
  where user_id is not null;

create index if not exists collector_activity_event_idx
  on public.collector_activity_logs (event_type, created_at desc);

create index if not exists collector_activity_ip_idx
  on public.collector_activity_logs (ip_hash, created_at desc)
  where ip_hash is not null;

alter table public.collector_activity_logs enable row level security;

-- Activity logs are service-role only. They may contain security metadata.
