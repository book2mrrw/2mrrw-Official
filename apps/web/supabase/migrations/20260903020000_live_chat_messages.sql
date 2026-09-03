-- Live chat, fully isolated from playback. Deliberately NOT the same table
-- as community_comments — that table allows guest-session posting with no
-- live-access gate, which would bypass the pay-per-view/subscriber/collector
-- access model this table's write path enforces (see
-- src/app/api/live/chat/send/route.js, which calls resolveLiveBroadcastAccess
-- before every insert).
--
-- No public RLS policies are defined on purpose: with RLS enabled and zero
-- policies, only the service role (used exclusively by the two API routes
-- above) can read or write this table. Real-time delivery goes over a
-- Supabase Realtime Broadcast channel sent by the server after a message is
-- authorized and stored — never a direct client subscription to this table —
-- so access control never has to be duplicated into an RLS policy.

create table if not exists public.live_chat_messages (
  id           uuid        primary key default gen_random_uuid(),
  broadcast_id uuid        not null references public.live_broadcasts(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  display_name text        not null,
  badge        text,
  is_creator   boolean     not null default false,
  body         text        not null check (char_length(body) between 1 and 500),
  created_at   timestamptz not null default now()
);

create index if not exists live_chat_messages_broadcast_idx
  on public.live_chat_messages (broadcast_id, created_at);

alter table public.live_chat_messages enable row level security;

comment on table public.live_chat_messages is
  'Live-event chat, service-role only (no client-side RLS policies). Access is enforced in the API routes via resolveLiveBroadcastAccess, not by RLS.';
