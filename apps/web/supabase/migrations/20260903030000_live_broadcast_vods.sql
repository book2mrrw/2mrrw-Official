-- VOD metadata for an ended broadcast. Metadata-only for now: Twitch has no
-- official API to download a VOD's actual video file (only title, duration,
-- thumbnail, and Twitch's own hosted playback), so playback continues to
-- reference Twitch's hosted copy via their embed player rather than a
-- locally re-hosted file in R2. A fully self-owned copy would require
-- recording at the Fly.io relay while the stream is live — a separate,
-- deliberately deferred change to the ingest pipeline.

create table if not exists public.live_broadcast_vods (
  id                uuid        primary key default gen_random_uuid(),
  broadcast_id      uuid        not null unique references public.live_broadcasts(id) on delete cascade,
  twitch_video_id   text        not null,
  title             text        not null,
  duration_seconds  integer,
  thumbnail_url     text,
  twitch_url        text        not null,
  published         boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.live_broadcast_vods enable row level security;

-- Public may only see published VODs; drafts stay admin-only until the
-- artist publishes them. This only gates visibility of the catalog entry —
-- actual playback access is still resolved per-broadcast server-side via
-- resolveLiveBroadcastAccess, the same function the live paywall uses.
drop policy if exists "live_broadcast_vods_published_read" on public.live_broadcast_vods;
create policy "live_broadcast_vods_published_read" on public.live_broadcast_vods
  for select using (published = true);

comment on table public.live_broadcast_vods is
  'Twitch VOD metadata for an ended broadcast. Publish/unpublish/delete managed by the artist via /api/admin/live/vods.';
