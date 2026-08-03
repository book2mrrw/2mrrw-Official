-- Notification, retention, and cross-device alert infrastructure.
-- This creates durable preferences/history now, while leaving SMS/email/push
-- provider delivery as a future integration layer.

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  web_push_enabled boolean not null default false,
  mobile_push_enabled boolean not null default false,
  release_alerts boolean not null default true,
  livestream_alerts boolean not null default true,
  collector_alerts boolean not null default true,
  vault_alerts boolean not null default true,
  audio_diary_alerts boolean not null default true,
  community_reply_alerts boolean not null default true,
  premium_unlock_alerts boolean not null default true,
  subscriber_alerts boolean not null default true,
  visibility text not null default 'full' check (visibility in ('full', 'quiet', 'minimal')),
  quiet_hours_start time,
  quiet_hours_end time,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_preferences_enabled_idx
  on public.notification_preferences (in_app_enabled, email_enabled, sms_enabled, web_push_enabled, mobile_push_enabled);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  title text not null,
  body text not null default '',
  audience text not null default 'all' check (audience in ('all', 'subscriber', 'collector', 'inner_circle', 'vault_pass', 'individual')),
  entitlement_scope text,
  action_url text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'canceled')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_events_status_idx
  on public.notification_events (status, scheduled_for, audience);

create table if not exists public.notification_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid references public.notification_events (id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null default '',
  action_url text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  read_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notification_inbox_user_idx
  on public.notification_inbox (user_id, created_at desc);

create index if not exists notification_inbox_unread_idx
  on public.notification_inbox (user_id, created_at desc)
  where read_at is null and archived_at is null;

create table if not exists public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notification_inbox (id) on delete cascade,
  event_id uuid references public.notification_events (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'web_push', 'mobile_push')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'suppressed', 'canceled')),
  provider text,
  provider_message_id text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_delivery_logs_user_idx
  on public.notification_delivery_logs (user_id, channel, status, created_at desc);

create table if not exists public.notification_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text,
  auth_secret text,
  user_agent text,
  device_label text not null default 'web',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_push_subscriptions_user_idx
  on public.notification_push_subscriptions (user_id, enabled, last_seen_at desc);

create table if not exists public.media_playback_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_slug text not null,
  media_type text not null default 'audio' check (media_type in ('audio', 'video', 'livestream', 'vault')),
  position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  completed boolean not null default false,
  replay_count integer not null default 0,
  last_played_at timestamptz not null default now(),
  device_label text not null default 'web',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_slug, media_type)
);

create index if not exists media_playback_progress_user_idx
  on public.media_playback_progress (user_id, last_played_at desc);

create table if not exists public.media_stream_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  product_slug text not null,
  event_type text not null check (event_type in ('play', 'progress', 'complete', 'replay', 'save')),
  media_type text not null default 'audio' check (media_type in ('audio', 'video', 'livestream', 'vault')),
  position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  completion_rate numeric(5,4),
  country text,
  region text,
  city text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists media_stream_events_slug_idx
  on public.media_stream_events (product_slug, event_type, created_at desc);

create index if not exists media_stream_events_user_idx
  on public.media_stream_events (user_id, created_at desc);

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists notification_events_updated_at on public.notification_events;
create trigger notification_events_updated_at
  before update on public.notification_events
  for each row execute function public.set_updated_at();

drop trigger if exists notification_delivery_logs_updated_at on public.notification_delivery_logs;
create trigger notification_delivery_logs_updated_at
  before update on public.notification_delivery_logs
  for each row execute function public.set_updated_at();

drop trigger if exists notification_push_subscriptions_updated_at on public.notification_push_subscriptions;
create trigger notification_push_subscriptions_updated_at
  before update on public.notification_push_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists media_playback_progress_updated_at on public.media_playback_progress;
create trigger media_playback_progress_updated_at
  before update on public.media_playback_progress
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_inbox enable row level security;
alter table public.notification_delivery_logs enable row level security;
alter table public.notification_push_subscriptions enable row level security;
alter table public.media_playback_progress enable row level security;
alter table public.media_stream_events enable row level security;

drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "notification_preferences_insert_own" on public.notification_preferences;
create policy "notification_preferences_insert_own"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own"
  on public.notification_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notification_inbox_select_own" on public.notification_inbox;
create policy "notification_inbox_select_own"
  on public.notification_inbox for select
  using (auth.uid() = user_id);

drop policy if exists "notification_inbox_update_own" on public.notification_inbox;
create policy "notification_inbox_update_own"
  on public.notification_inbox for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notification_delivery_logs_select_own" on public.notification_delivery_logs;
create policy "notification_delivery_logs_select_own"
  on public.notification_delivery_logs for select
  using (auth.uid() = user_id);

drop policy if exists "notification_push_subscriptions_select_own" on public.notification_push_subscriptions;
create policy "notification_push_subscriptions_select_own"
  on public.notification_push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "notification_push_subscriptions_insert_own" on public.notification_push_subscriptions;
create policy "notification_push_subscriptions_insert_own"
  on public.notification_push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "notification_push_subscriptions_update_own" on public.notification_push_subscriptions;
create policy "notification_push_subscriptions_update_own"
  on public.notification_push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "media_playback_progress_select_own" on public.media_playback_progress;
create policy "media_playback_progress_select_own"
  on public.media_playback_progress for select
  using (auth.uid() = user_id);

drop policy if exists "media_playback_progress_insert_own" on public.media_playback_progress;
create policy "media_playback_progress_insert_own"
  on public.media_playback_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "media_playback_progress_update_own" on public.media_playback_progress;
create policy "media_playback_progress_update_own"
  on public.media_playback_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_inbox'
  ) then
    alter publication supabase_realtime add table public.notification_inbox;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_preferences'
  ) then
    alter publication supabase_realtime add table public.notification_preferences;
  end if;
end $$;
