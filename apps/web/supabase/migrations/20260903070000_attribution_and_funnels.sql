-- Marketing attribution + funnel/cohort analytics. No UTM/referrer capture,
-- funnel-step tracking, or cohort retention existed anywhere in this codebase
-- before this migration (confirmed by repo-wide search) — from-scratch,
-- entirely read-side over data that already exists (profiles, media_stream_
-- events, purchases), so nothing in the write paths for streaming or
-- checkout needs to change to power these.

-- First-touch marketing attribution, captured client-side once per visitor
-- (a plain, non-sensitive cookie — see src/components/system/
-- MarketingAttributionCapture.js) and stamped onto the profile at signup
-- time (src/lib/auth/attribution-cookie.js). jsonb rather than five scalar
-- columns because which keys are present varies by channel (utm_term/content
-- are rare; a bare referrer visit has neither).
alter table public.profiles
  add column if not exists first_touch jsonb;

-- Signups -> first stream -> first purchase, for a window starting at `since`.
create or replace function public.get_funnel_stats(since timestamptz)
returns table (
  signups   bigint,
  streamed  bigint,
  purchased bigint
)
language sql
stable
security definer
as $$
  with first_stream as (
    select user_id, min(created_at) as first_stream_at
    from public.media_stream_events
    where event_type = 'play' and user_id is not null
    group by user_id
  ),
  first_purchase as (
    select user_id, min(purchased_at) as first_purchase_at
    from public.purchases
    where status = 'completed'
    group by user_id
  )
  select
    count(*) filter (where p.created_at >= since) as signups,
    count(*) filter (where p.created_at >= since and fs.first_stream_at is not null) as streamed,
    count(*) filter (where p.created_at >= since and fp.first_purchase_at is not null) as purchased
  from public.profiles p
  left join first_stream fs on fs.user_id = p.id
  left join first_purchase fp on fp.user_id = p.id;
$$;

grant execute on function public.get_funnel_stats(timestamptz) to service_role;

-- Monthly signup cohorts, each row one (cohort_month, month_offset) pair:
-- how many of that cohort had at least one stream in cohort_month + offset.
-- month_offset rows past "now" are excluded (a cohort can't yet have data for
-- a month that hasn't happened).
create or replace function public.get_cohort_retention(months_back int default 6)
returns table (
  cohort_month  text,
  cohort_size   bigint,
  month_offset  int,
  retained_fans bigint
)
language sql
stable
security definer
as $$
  with cohorts as (
    select id as user_id, date_trunc('month', created_at) as cohort_month
    from public.profiles
    where created_at >= date_trunc('month', now()) - (months_back || ' months')::interval
  ),
  cohort_sizes as (
    select cohort_month, count(*) as cohort_size
    from cohorts
    group by cohort_month
  ),
  activity_months as (
    select distinct user_id, date_trunc('month', created_at) as active_month
    from public.media_stream_events
    where event_type = 'play' and user_id is not null
  ),
  offsets as (
    select generate_series(0, months_back) as month_offset
  )
  select
    to_char(c.cohort_month, 'YYYY-MM') as cohort_month,
    cs.cohort_size,
    o.month_offset,
    count(distinct am.user_id) as retained_fans
  from cohorts c
  join cohort_sizes cs on cs.cohort_month = c.cohort_month
  cross join offsets o
  left join activity_months am
    on am.user_id = c.user_id
   and am.active_month = c.cohort_month + (o.month_offset || ' months')::interval
  where c.cohort_month + (o.month_offset || ' months')::interval <= date_trunc('month', now())
  group by c.cohort_month, cs.cohort_size, o.month_offset
  order by c.cohort_month, o.month_offset;
$$;

grant execute on function public.get_cohort_retention(int) to service_role;

-- Signups/purchases/revenue grouped by first-touch source/medium/campaign.
-- Profiles with no first_touch (signed up before this existed, or arrived
-- direct with no UTM/referrer) bucket under 'direct'/'none' rather than being
-- dropped, so totals here always reconcile with plain signup counts.
create or replace function public.get_attribution_breakdown(since timestamptz)
returns table (
  source        text,
  medium        text,
  campaign      text,
  signups       bigint,
  purchases     bigint,
  revenue_cents bigint
)
language sql
stable
security definer
as $$
  with attributed as (
    select
      id as user_id,
      coalesce(first_touch->>'source', 'direct') as source,
      coalesce(first_touch->>'medium', 'none') as medium,
      coalesce(first_touch->>'campaign', 'none') as campaign
    from public.profiles
    where created_at >= since
  ),
  purchase_totals as (
    select user_id, count(*) as purchases, sum(amount_cents) as revenue_cents
    from public.purchases
    where status = 'completed'
    group by user_id
  )
  select
    a.source, a.medium, a.campaign,
    count(*) as signups,
    coalesce(sum(pt.purchases), 0) as purchases,
    coalesce(sum(pt.revenue_cents), 0)::bigint as revenue_cents
  from attributed a
  left join purchase_totals pt on pt.user_id = a.user_id
  group by a.source, a.medium, a.campaign
  order by signups desc;
$$;

grant execute on function public.get_attribution_breakdown(timestamptz) to service_role;
