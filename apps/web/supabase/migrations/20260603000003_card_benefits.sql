-- Benefits tied to collector_card entitlement (checkout discounts, event perks).

create table if not exists public.card_benefits (
  id uuid primary key default gen_random_uuid(),
  benefit_key text not null unique,
  label text not null,
  benefit_type text not null check (benefit_type in ('checkout_discount', 'vault_access', 'event_entry', 'custom')),
  value_numeric numeric(8, 2),
  value_text text,
  requires_entitlement text not null default 'collector_card' check (
    requires_entitlement in ('collector_card', 'subscriber', 'vault_access')
  ),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.card_benefits enable row level security;

drop policy if exists "card_benefits_select_active" on public.card_benefits;
create policy "card_benefits_select_active"
  on public.card_benefits
  for select
  using (active = true);

drop trigger if exists card_benefits_updated_at on public.card_benefits;
create trigger card_benefits_updated_at
  before update on public.card_benefits
  for each row execute function public.set_updated_at();

insert into public.card_benefits (benefit_key, label, benefit_type, value_numeric, requires_entitlement, metadata)
values (
  'collector_checkout_15',
  'Collector card checkout discount',
  'checkout_discount',
  15,
  'collector_card',
  '{"percent_off":15,"applies_to":"digital_merch_excluded_vinyl"}'::jsonb
)
on conflict (benefit_key) do update set
  label = excluded.label,
  benefit_type = excluded.benefit_type,
  value_numeric = excluded.value_numeric,
  active = true,
  updated_at = now();
