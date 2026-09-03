-- P1 analytics RPCs: per-release revenue (from the new purchase_items ledger),
-- per-track play stats (unambiguous once media_stream_events.product_id is
-- populated), and a point-in-time subscription snapshot.

-- Per-release/per-product gross revenue and units sold, summed from the
-- real per-item allocation in purchase_items rather than the single
-- purchases.amount_cents total — so a multi-item cart's revenue attributes
-- correctly to each release instead of only being countable in aggregate.
create or replace function public.get_release_revenue_stats(since timestamptz)
returns table (
  product_id   uuid,
  product_slug text,
  title        text,
  release_id   uuid,
  gross_cents  bigint,
  items_sold   bigint
)
language sql
stable
security definer
as $$
  select
    pi.product_id,
    pi.product_slug,
    coalesce(prod.title, pi.title) as title,
    coalesce(pi.release_id, prod.release_id) as release_id,
    sum(pi.unit_price_cents * pi.quantity)::bigint as gross_cents,
    sum(pi.quantity)::bigint as items_sold
  from public.purchase_items pi
  join public.purchases pu on pu.id = pi.purchase_id
  left join public.products prod on prod.id = pi.product_id
  where pu.status = 'completed'
    and pu.purchased_at >= since
  group by pi.product_id, pi.product_slug, coalesce(prod.title, pi.title), coalesce(pi.release_id, prod.release_id)
  order by gross_cents desc;
$$;

grant execute on function public.get_release_revenue_stats(timestamptz) to service_role;

-- Per-track plays/completion, grouped by (product_id, product_slug) so two
-- different albums' same-named tracks never merge. Only covers events written
-- after media_stream_events.product_id existed — older rows have no product_id
-- and are excluded here, same as the design tradeoff documented on that column.
create or replace function public.get_track_play_stats(since timestamptz)
returns table (
  product_id    uuid,
  track_slug    text,
  display_title text,
  album_slug    text,
  plays         bigint,
  avg_completion numeric
)
language sql
stable
security definer
as $$
  select
    e.product_id,
    e.product_slug as track_slug,
    coalesce(ct.title, prod.title) as display_title,
    prod.slug as album_slug,
    count(*) as plays,
    avg(e.completion_rate)::numeric as avg_completion
  from public.media_stream_events e
  join public.products prod on prod.id = e.product_id
  left join public.catalog_tracks ct on ct.product_id = e.product_id and ct.slug = e.product_slug
  where e.event_type = 'play'
    and e.created_at >= since
    and e.product_id is not null
  group by e.product_id, e.product_slug, ct.title, prod.title, prod.slug
  order by plays desc;
$$;

grant execute on function public.get_track_play_stats(timestamptz) to service_role;

-- Point-in-time subscription snapshot. memberships has no historical
-- transition log (each row is overwritten in place on status change), so this
-- is "as of now" only — not a time-series/trend. MRR sums price_cents, which
-- is only populated on subscriptions written after the membership_pricing
-- migration; rows predating it contribute 0 until their next Stripe webhook.
create or replace function public.get_subscription_stats()
returns table (
  active_count       bigint,
  trialing_count     bigint,
  past_due_count     bigint,
  canceled_last_30d  bigint,
  mrr_cents          bigint
)
language sql
stable
security definer
as $$
  select
    count(*) filter (where status = 'active') as active_count,
    count(*) filter (where status = 'trialing') as trialing_count,
    count(*) filter (where status = 'past_due') as past_due_count,
    count(*) filter (where status = 'canceled' and canceled_at >= now() - interval '30 days') as canceled_last_30d,
    coalesce(sum(price_cents) filter (where status in ('active', 'trialing')), 0)::bigint as mrr_cents
  from public.memberships;
$$;

grant execute on function public.get_subscription_stats() to service_role;
