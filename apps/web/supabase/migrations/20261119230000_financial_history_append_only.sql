-- Financial history is append-only.
--
-- A sale is recorded once and never rewritten. Money that moves later —
-- refunds, disputes, dispute reversals — is its own dated row in
-- purchase_adjustments, so a September sale refunded in November stays in
-- September's gross sales and shows as a November refund. The database
-- enforces this; application code cannot silently change past amounts.

-- ── 1. Adjustments: append-only ledger of post-sale money movement ──────────
create table if not exists public.purchase_adjustments (
  id                       uuid primary key default gen_random_uuid(),
  purchase_id              uuid not null references public.purchases(id) on delete restrict,
  kind                     text not null check (kind in ('refund', 'dispute', 'dispute_reversal')),
  -- Signed: negative = money returned to the buyer / withdrawn by the bank.
  amount_cents             integer not null,
  currency                 text not null default 'usd',
  stripe_object_id         text,   -- re_… (refund) or dp_/du_… (dispute)
  stripe_payment_intent_id text,
  reason                   text,
  occurred_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  metadata                 jsonb not null default '{}'::jsonb
);

-- One row per Stripe object and kind: webhook retries and the synchronous
-- path cannot double-record the same refund. NULLs never conflict.
create unique index if not exists purchase_adjustments_kind_object_key
  on public.purchase_adjustments (kind, stripe_object_id);
create index if not exists purchase_adjustments_purchase_idx on public.purchase_adjustments (purchase_id);
create index if not exists purchase_adjustments_occurred_idx on public.purchase_adjustments (occurred_at desc);

alter table public.purchase_adjustments enable row level security;
revoke all on public.purchase_adjustments from public, anon, authenticated;
grant select, insert on public.purchase_adjustments to service_role;

create or replace function public.forbid_history_rewrite()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op using errcode = '42501';
end $$;

drop trigger if exists purchase_adjustments_append_only on public.purchase_adjustments;
create trigger purchase_adjustments_append_only
  before update or delete on public.purchase_adjustments
  for each row execute function public.forbid_history_rewrite();

-- ── 2. Sale facts are fixed once a sale completes ───────────────────────────
-- Webhook retries re-upsert the purchase with purchased_at = now(), which
-- moved the sale date to the retry time. Updates may still change status,
-- ownership anonymization and shipping; amount, currency, sale date, kind,
-- items and Stripe references keep their original values.
create or replace function public.preserve_purchase_sale_facts()
returns trigger language plpgsql as $$
begin
  if old.status in ('completed', 'refunded') then
    new.amount_cents := old.amount_cents;
    new.currency := old.currency;
    new.purchased_at := coalesce(old.purchased_at, new.purchased_at);
    new.created_at := old.created_at;
    new.purchase_type := old.purchase_type;
    if old.items is not null and jsonb_typeof(old.items) = 'array' and jsonb_array_length(old.items) > 0 then
      new.items := old.items;
    end if;
    new.stripe_payment_intent_id := coalesce(old.stripe_payment_intent_id, new.stripe_payment_intent_id);
    new.stripe_checkout_session_id := coalesce(old.stripe_checkout_session_id, new.stripe_checkout_session_id);
  end if;
  return new;
end $$;

drop trigger if exists purchases_preserve_sale_facts on public.purchases;
create trigger purchases_preserve_sale_facts
  before update on public.purchases
  for each row execute function public.preserve_purchase_sale_facts();

-- ── 3. Line items are append-only ───────────────────────────────────────────
drop trigger if exists purchase_items_append_only on public.purchase_items;
create trigger purchase_items_append_only
  before update or delete on public.purchase_items
  for each row execute function public.forbid_history_rewrite();

-- ── 4. Remove the leftover ON DELETE CASCADE key on purchases.user_id ───────
-- Production carried two keys on user_id: the intended SET NULL one and an
-- older CASCADE one, so deleting a user outside the account-lifecycle flow
-- could delete their purchases. Only CASCADE keys on user_id are dropped.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.purchases'::regclass and contype = 'f' and confdeltype = 'c'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.purchases'::regclass and attname = 'user_id')]::smallint[]
  loop
    execute format('alter table public.purchases drop constraint %I', c.conname);
  end loop;
end $$;

-- ── 5. Backfill line items for paid sales recorded before purchase_items ───
-- (production: one paid sale, 2026-05-21). Even split; the first item takes
-- the remainder cent. Gifts and free claims carry no money and get none.
insert into public.purchase_items (purchase_id, product_id, product_slug, title, item_type, unit_price_cents, quantity)
select
  s.purchase_id, pr.id, s.slug, s.title, s.item_type,
  (s.amount_cents / s.n) + case when s.rn = 1 then s.amount_cents % s.n else 0 end,
  1
from (
  select
    p.id as purchase_id, p.amount_cents,
    it.value->>'slug' as slug, it.value->>'title' as title,
    case it.value->>'type' when 'merch' then 'merch' else 'digital' end as item_type,
    row_number() over (partition by p.id order by it.ord) as rn,
    count(*) over (partition by p.id) as n
  from public.purchases p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end)
    with ordinality as it(value, ord)
  where p.status in ('completed', 'refunded')
    and p.amount_cents > 0
    and coalesce(p.purchase_type, 'purchase') <> 'gift'
    and nullif(it.value->>'slug', '') is not null
    and not exists (select 1 from public.purchase_items x where x.purchase_id = p.id)
) s
left join public.products pr on pr.slug = s.slug;

-- Purchases already marked refunded before this ledger existed get one
-- adjustment so net revenue is right; their real refund date is unknown, so
-- it is recorded at the sale date and flagged. (Production had none.)
insert into public.purchase_adjustments (purchase_id, kind, amount_cents, currency, stripe_object_id, stripe_payment_intent_id, occurred_at, metadata)
select p.id, 'refund', -p.amount_cents, coalesce(p.currency, 'usd'), 'backfill:' || p.id::text, p.stripe_payment_intent_id,
       coalesce(p.purchased_at, p.created_at), '{"backfilled": true, "note": "refund date unknown; recorded at sale date"}'::jsonb
from public.purchases p
where p.status = 'refunded' and p.amount_cents > 0
  and not exists (select 1 from public.purchase_adjustments a where a.purchase_id = p.id and a.kind = 'refund')
on conflict (kind, stripe_object_id) do nothing;

-- ── 6. Revenue: sales in their own period, adjustments in theirs ────────────
create or replace function public.analytics_revenue_summary(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  gross_sales_cents bigint, refunds_cents bigint, disputes_cents bigint, net_cents bigint,
  paid_orders bigint, refunded_orders bigint, gifts bigint
)
language sql stable set search_path = public as $$
  with sales as (
    select * from public.purchases
    where status in ('completed', 'refunded') and amount_cents > 0
      and coalesce(purchase_type, 'purchase') <> 'gift'
      and (p_from is null or purchased_at >= p_from) and (p_to is null or purchased_at < p_to)
  ),
  adj as (
    select * from public.purchase_adjustments
    where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at < p_to)
  )
  select
    coalesce((select sum(amount_cents) from sales), 0)::bigint,
    coalesce((select -sum(amount_cents) from adj where kind = 'refund'), 0)::bigint,
    coalesce((select -sum(amount_cents) from adj where kind in ('dispute', 'dispute_reversal')), 0)::bigint,
    (coalesce((select sum(amount_cents) from sales), 0) + coalesce((select sum(amount_cents) from adj), 0))::bigint,
    (select count(*) from sales),
    (select count(distinct purchase_id) from adj where kind = 'refund'),
    (select count(*) from public.purchases
       where purchase_type = 'gift'
         and (p_from is null or coalesce(purchased_at, created_at) >= p_from)
         and (p_to is null or coalesce(purchased_at, created_at) < p_to));
$$;

-- Release revenue keeps a refunded sale in its sale period (refunds are
-- reported separately) instead of erasing it from history.
create or replace function public.get_release_revenue_stats(since timestamptz)
returns table (product_id uuid, product_slug text, title text, release_id uuid, gross_cents bigint, items_sold bigint)
language sql stable security definer set search_path = public as $$
  select
    pi.product_id, pi.product_slug,
    coalesce(prod.title, pi.title) as title,
    coalesce(pi.release_id, prod.release_id) as release_id,
    sum(pi.unit_price_cents * pi.quantity)::bigint as gross_cents,
    sum(pi.quantity)::bigint as items_sold
  from public.purchase_items pi
  join public.purchases pu on pu.id = pi.purchase_id
  left join public.products prod on prod.id = pi.product_id
  where pu.status in ('completed', 'refunded')
    and pu.purchased_at >= since
  group by pi.product_id, pi.product_slug, coalesce(prod.title, pi.title), coalesce(pi.release_id, prod.release_id)
  order by gross_cents desc;
$$;

revoke all on function public.analytics_revenue_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.analytics_revenue_summary(timestamptz, timestamptz) to service_role;
revoke all on function public.get_release_revenue_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.get_release_revenue_stats(timestamptz) to service_role;
revoke all on function public.forbid_history_rewrite() from public, anon, authenticated;
revoke all on function public.preserve_purchase_sale_facts() from public, anon, authenticated;
