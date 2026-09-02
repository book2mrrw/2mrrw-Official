-- Durable Twitch EventSub ingestion and atomic live-broadcast authority.
-- The service role is the only writer; consumer clients never receive webhook payloads.

alter table public.live_broadcasts
  add column if not exists twitch_stream_id text,
  add column if not exists started_at timestamptz,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists provider_status text not null default 'offline'
    check (provider_status in ('unknown', 'offline', 'live'));

update public.live_broadcasts
   set provider_status = case when is_live then 'live' else 'offline' end,
       started_at = case when is_live then coalesce(started_at, goes_live_at, updated_at) else started_at end,
       ended_at = case when is_live then null else ended_at end;

-- Preserve one deterministic live row if legacy/manual writes ever created more
-- than one, then enforce the invariant for every future writer.
with ranked_live as (
  select id,
         row_number() over (
           order by coalesce(started_at, goes_live_at, updated_at, created_at) desc, id
         ) as live_rank
    from public.live_broadcasts
   where is_live = true
)
update public.live_broadcasts as broadcast
   set is_live = false,
       provider_status = 'offline',
       ended_at = coalesce(broadcast.ended_at, now()),
       updated_at = now()
  from ranked_live
 where broadcast.id = ranked_live.id
   and ranked_live.live_rank > 1;

create index if not exists live_broadcasts_upcoming_idx
  on public.live_broadcasts (goes_live_at asc)
  where is_live = false and ended_at is null;

create table if not exists public.twitch_eventsub_receipts (
  message_id text primary key,
  message_timestamp timestamptz not null,
  message_type text not null,
  event_type text,
  subscription_id text,
  broadcaster_user_id text,
  broadcaster_user_login text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'dead_letter')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists twitch_eventsub_receipts_pending_idx
  on public.twitch_eventsub_receipts (next_attempt_at, created_at)
  where status = 'pending';

alter table public.twitch_eventsub_receipts enable row level security;
revoke all on table public.twitch_eventsub_receipts from anon, authenticated;

create table if not exists public.twitch_eventsub_runtime_config (
  singleton boolean primary key default true check (singleton = true),
  broadcaster_login text not null,
  callback_url text not null,
  secret_fingerprint text not null,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.twitch_eventsub_runtime_config enable row level security;
revoke all on table public.twitch_eventsub_runtime_config from anon, authenticated;

create or replace function public.claim_twitch_eventsub_receipt(p_message_id text)
returns setof public.twitch_eventsub_receipts
language sql
security definer
set search_path = public
as $$
  update public.twitch_eventsub_receipts
     set status = 'processing',
         attempt_count = attempt_count + 1,
         processing_started_at = now(),
         updated_at = now()
   where message_id = p_message_id
     and status = 'pending'
     and next_attempt_at <= now()
  returning *;
$$;

revoke all on function public.claim_twitch_eventsub_receipt(text) from public, anon, authenticated;
grant execute on function public.claim_twitch_eventsub_receipt(text) to service_role;

create or replace function public.promote_live_broadcast(
  p_broadcast_id uuid,
  p_twitch_stream_id text default null,
  p_started_at timestamptz default now(),
  p_provider_event_at timestamptz default now()
)
returns setof public.live_broadcasts
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize provider transitions even when EventSub and the reconciler arrive
  -- together. This is transaction-scoped and never blocks storefront reads.
  perform pg_advisory_xact_lock(hashtext('public.live_broadcasts:twitch-provider'));

  if not exists (
    select 1 from public.live_broadcasts where id = p_broadcast_id
  ) then
    return;
  end if;

  if exists (
    select 1
      from public.live_broadcasts
     where id = p_broadcast_id
       and last_provider_event_at is not null
       and p_provider_event_at is not null
       and last_provider_event_at > p_provider_event_at
  ) then
    return;
  end if;

  update public.live_broadcasts
     set is_live = false,
         provider_status = 'offline',
         ended_at = coalesce(ended_at, now()),
         updated_at = now()
   where is_live = true
     and id <> p_broadcast_id;

  return query
  update public.live_broadcasts
     set is_live = true,
         provider_status = 'live',
         twitch_stream_id = coalesce(p_twitch_stream_id, twitch_stream_id),
         started_at = coalesce(started_at, p_started_at, now()),
         ended_at = null,
         last_provider_event_at = greatest(
           coalesce(last_provider_event_at, '-infinity'::timestamptz),
           coalesce(p_provider_event_at, now())
         ),
         updated_at = now()
   where id = p_broadcast_id
  returning *;
end;
$$;

revoke all on function public.promote_live_broadcast(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.promote_live_broadcast(uuid, text, timestamptz, timestamptz) to service_role;

create or replace function public.demote_live_broadcast(
  p_broadcast_id uuid,
  p_provider_event_at timestamptz default now()
)
returns setof public.live_broadcasts
language sql
security definer
set search_path = public
as $$
  update public.live_broadcasts
     set is_live = false,
         provider_status = 'offline',
         ended_at = coalesce(p_provider_event_at, now()),
         last_provider_event_at = greatest(
           coalesce(last_provider_event_at, '-infinity'::timestamptz),
           coalesce(p_provider_event_at, now())
         ),
         updated_at = now()
   where id = p_broadcast_id
     and (
       last_provider_event_at is null
       or p_provider_event_at is null
       or p_provider_event_at >= last_provider_event_at
     )
  returning *;
$$;

revoke all on function public.demote_live_broadcast(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.demote_live_broadcast(uuid, timestamptz) to service_role;

alter table public.notification_inbox
  add column if not exists dedupe_key text;

create unique index if not exists notification_inbox_dedupe_idx
  on public.notification_inbox (dedupe_key)
  where dedupe_key is not null;

create table if not exists public.livestream_notification_dispatches (
  broadcast_id uuid not null references public.live_broadcasts(id) on delete cascade,
  notification_type text not null check (notification_type in ('24h', 'prelive', 'live')),
  status text not null default 'processing' check (status in ('processing', 'completed', 'partial')),
  error_details jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (broadcast_id, notification_type)
);

alter table public.livestream_notification_dispatches enable row level security;
revoke all on table public.livestream_notification_dispatches from anon, authenticated;

create or replace function public.claim_livestream_notification_dispatch(
  p_broadcast_id uuid,
  p_notification_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  insert into public.livestream_notification_dispatches (
    broadcast_id, notification_type, status, started_at, updated_at
  ) values (
    p_broadcast_id, p_notification_type, 'processing', now(), now()
  )
  on conflict (broadcast_id, notification_type) do nothing;
  if found then return true; end if;

  update public.livestream_notification_dispatches
     set status = 'processing', started_at = now(), updated_at = now()
   where broadcast_id = p_broadcast_id
     and notification_type = p_notification_type
     and status = 'processing'
     and updated_at < now() - interval '10 minutes';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.claim_livestream_notification_dispatch(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_livestream_notification_dispatch(uuid, text) to service_role;
