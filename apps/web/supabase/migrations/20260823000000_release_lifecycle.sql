-- Connected release lifecycle authority. All fields remain attached to the
-- canonical releases.id; products are a storefront projection only.

alter table public.releases
  add column if not exists available_at timestamptz,
  add column if not exists release_timezone text not null default 'America/Chicago',
  add column if not exists upcoming_visible boolean not null default false,
  add column if not exists preview_before_release boolean not null default false,
  add column if not exists preorder_enabled boolean not null default false,
  add column if not exists preorder_starts_at timestamptz,
  add column if not exists preorder_price_cents integer,
  add column if not exists early_access_enabled boolean not null default false,
  add column if not exists early_access_starts_at timestamptz,
  add column if not exists early_access_scope jsonb not null default '{"mode":"full_release","track_ids":[]}'::jsonb,
  add column if not exists early_access_audiences text[] not null default array['preorder_purchasers']::text[],
  add column if not exists published_at timestamptz,
  add column if not exists unavailable_at timestamptz;

alter table public.releases drop constraint if exists releases_preorder_price_nonnegative;
alter table public.releases add constraint releases_preorder_price_nonnegative
  check (preorder_price_cents is null or preorder_price_cents >= 0);

alter table public.releases drop constraint if exists releases_lifecycle_time_order;
alter table public.releases add constraint releases_lifecycle_time_order check (
  available_at is null
  or (preorder_starts_at is null or preorder_starts_at <= available_at)
  and (early_access_starts_at is null or early_access_starts_at <= available_at)
);

create index if not exists releases_available_at_idx on public.releases (available_at);
create index if not exists releases_public_lifecycle_idx
  on public.releases (upcoming_visible, available_at)
  where status in ('scheduled', 'published');

-- Existing scheduled rows retain their intended instant. Existing published
-- rows are immediately live. This migration is idempotent.
update public.releases
set available_at = coalesce(available_at, scheduled_at)
where status = 'scheduled' and available_at is null;

update public.releases
set available_at = coalesce(available_at, created_at, now()),
    published_at = coalesce(published_at, created_at, now())
where status = 'published';

comment on column public.releases.available_at is
  'Authoritative UTC instant when normal release access begins; evaluated at request time.';
comment on column public.releases.release_timezone is
  'IANA timezone used to interpret and display the administrator wall-clock schedule.';
comment on column public.releases.upcoming_visible is
  'Whether a not-yet-live release may appear in its canonical storefront section.';
comment on column public.releases.early_access_scope is
  'Extensible access scope: full_release initially; selected track IDs supported by the contract.';
