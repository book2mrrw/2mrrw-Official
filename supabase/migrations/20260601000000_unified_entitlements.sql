-- Unified entitlements ledger (additive; library_items remains authoritative during parity window).
-- Rollback (pre-launch only): drop table if empty — see docs in migration plan 03-DATABASE-MIGRATION-PLAN.

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  resource_type text not null check (resource_type in ('product', 'track', 'release', 'vault_collection')),
  resource_id uuid not null,
  source_type text not null check (source_type in (
    'purchase', 'gifted', 'subscription', 'collector_card', 'promo', 'admin_grant'
  )),
  source_id uuid,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists entitlements_active_unique
  on public.entitlements (
    user_id,
    resource_type,
    resource_id,
    source_type,
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

create index if not exists entitlements_user_resource_idx
  on public.entitlements (user_id, resource_type, resource_id);

create index if not exists entitlements_source_idx
  on public.entitlements (source_type, source_id)
  where source_id is not null;

alter table public.entitlements enable row level security;

drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements
  for select using (auth.uid() = user_id);

drop trigger if exists entitlements_updated_at on public.entitlements;
create trigger entitlements_updated_at before update on public.entitlements
  for each row execute function public.set_updated_at();

comment on table public.entitlements is 'Canonical entitlement ledger; dual-written from library_items during migration.';

-- One-time backfill from library_items (idempotent via active unique index).
insert into public.entitlements (
  user_id,
  resource_type,
  resource_id,
  source_type,
  source_id,
  status,
  starts_at,
  metadata
)
select
  li.user_id,
  'product'::text,
  li.product_id,
  case li.source
    when 'purchase' then 'purchase'
    when 'gift' then 'gifted'
    when 'grant' then 'admin_grant'
    when 'bundle' then 'purchase'
    else 'purchase'
  end,
  li.purchase_id,
  'active',
  coalesce(li.granted_at, now()),
  jsonb_build_object('backfill', 'library_items', 'library_item_id', li.id)
from public.library_items li
where not exists (
  select 1
  from public.entitlements e
  where e.user_id = li.user_id
    and e.resource_type = 'product'
    and e.resource_id = li.product_id
    and e.source_type = case li.source
      when 'purchase' then 'purchase'
      when 'gift' then 'gifted'
      when 'grant' then 'admin_grant'
      when 'bundle' then 'purchase'
      else 'purchase'
    end
    and coalesce(e.source_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(li.purchase_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and e.status = 'active'
);
