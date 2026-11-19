-- Analytics event schema v1 (media_stream_events).
--
-- Additive only: every new column is nullable or defaulted, the old event
-- types stay valid, and the ingest route (src/app/api/media/playback) keeps
-- writing legacy rows until this is applied, so apply order does not matter.
--
-- Owner rules: analytics are a permanent career record (no row is ever
-- deleted on a schedule); "downloads" are in-app offline saves; a qualified
-- play is 30 seconds actually heard (or the whole of a shorter song).

alter table public.media_stream_events
  add column if not exists event_id           uuid,
  add column if not exists device_id          uuid,
  add column if not exists session_id         uuid,
  add column if not exists listen_id          uuid,
  add column if not exists release_slug       text,
  add column if not exists track_slug         text,
  add column if not exists listened_seconds   numeric(10,2),
  add column if not exists platform           text,
  add column if not exists access_tier        text,
  add column if not exists is_internal        boolean not null default false,
  add column if not exists offline            boolean not null default false,
  add column if not exists client_recorded_at timestamptz,
  add column if not exists schema_version     smallint not null default 0;

alter table public.media_stream_events drop constraint if exists media_stream_events_event_type_check;
alter table public.media_stream_events add constraint media_stream_events_event_type_check
  check (event_type in ('play','qualified','progress','pause','seek','skip','complete','replay','save','download','download_remove'));

alter table public.media_stream_events drop constraint if exists media_stream_events_platform_check;
alter table public.media_stream_events add constraint media_stream_events_platform_check
  check (platform is null or platform in ('web','ios','android'));

alter table public.media_stream_events drop constraint if exists media_stream_events_access_tier_check;
alter table public.media_stream_events add constraint media_stream_events_access_tier_check
  check (access_tier is null or access_tier in ('full','preview','admin'));

-- Idempotency: a retried or offline-replayed event is stored once.
-- Plain (non-partial) unique index so PostgREST upsert ON CONFLICT (event_id)
-- can use it; legacy rows have NULL event_id and NULLs never conflict.
create unique index if not exists media_stream_events_event_id_key
  on public.media_stream_events (event_id);

create index if not exists media_stream_events_track_idx
  on public.media_stream_events (product_id, track_slug, event_type, created_at desc);
create index if not exists media_stream_events_device_idx
  on public.media_stream_events (device_id, created_at desc) where device_id is not null;
create index if not exists media_stream_events_listen_idx
  on public.media_stream_events (listen_id) where listen_id is not null;
create index if not exists media_stream_events_time_idx
  on public.media_stream_events (created_at desc, event_type);

comment on column public.media_stream_events.event_id is 'Client-generated UUID; unique. Retries and offline replays are stored once.';
comment on column public.media_stream_events.device_id is 'Anonymous first-party per-install ID (no fingerprinting); identifies signed-out listeners.';
comment on column public.media_stream_events.listen_id is 'One listen of one recording, from start to end/skip; groups play, qualified, progress and complete.';
comment on column public.media_stream_events.track_slug is 'Song slug within its release (album songs); null for singles, where product_slug is the song.';
comment on column public.media_stream_events.listened_seconds is 'Seconds actually heard in this listen so far (seeks and stalls excluded).';
comment on column public.media_stream_events.access_tier is 'full | preview | admin. admin is set by the server from the session, never from the client.';
comment on column public.media_stream_events.is_internal is 'True for admin sessions. Excluded from every fan metric, kept for audit.';
comment on column public.media_stream_events.offline is 'Recorded while the device was offline (in-app downloads) and delivered later.';
comment on column public.media_stream_events.client_recorded_at is 'When it happened on the device; created_at is when the server received it.';
