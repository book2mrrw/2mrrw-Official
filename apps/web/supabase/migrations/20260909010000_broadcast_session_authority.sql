-- Broadcast authority is separate from public Twitch provider status.
-- No public/authenticated table access: all reads and writes require server authorization.
begin;

create table public.broadcast_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id),
  creation_fingerprint text not null,
  release_id uuid references public.releases(id),
  live_broadcast_id uuid references public.live_broadcasts(id),
  sequence bigint not null default 0 check (sequence >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broadcast_snapshot_required check (snapshot ?& array['id','sequence','state','type','items','isPlaying','mediaPosition']),
  constraint broadcast_snapshot_types check (
    jsonb_typeof(snapshot->'id') = 'string' and jsonb_typeof(snapshot->'sequence') = 'number'
    and jsonb_typeof(snapshot->'state') = 'string' and jsonb_typeof(snapshot->'type') = 'string'
    and jsonb_typeof(snapshot->'isPlaying') = 'boolean' and jsonb_typeof(snapshot->'mediaPosition') = 'number'),
  constraint broadcast_snapshot_items check (jsonb_typeof(snapshot->'items') = 'array'),
  constraint broadcast_snapshot_identity check (snapshot->>'id' = id::text),
  constraint broadcast_snapshot_sequence check ((snapshot->>'sequence')::bigint = sequence),
  constraint broadcast_snapshot_state check (snapshot->>'state' in
    ('DRAFT','SCHEDULED','PRE_SHOW','LIVE_INTRO','TRACK_PLAYBACK','ARTIST_COMMENTARY',
     'AUDIENCE_REACTION','INTERMISSION','FINALE','AFTERSHOW','ENDED'))
);
create index broadcast_sessions_host_updated on public.broadcast_sessions(host_id, updated_at desc);

create table public.broadcast_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.broadcast_sessions(id) on delete cascade,
  command_id uuid not null,
  command_fingerprint text not null,
  sequence bigint not null check (sequence > 0),
  actor_id uuid not null references auth.users(id),
  command_type text not null,
  issued_at timestamptz not null default clock_timestamp(),
  schema_version integer not null default 1 check (schema_version = 1),
  snapshot jsonb not null,
  unique(session_id, sequence),
  unique(session_id, command_id)
);

alter table public.broadcast_sessions enable row level security;
create table public.broadcast_session_grants (
  session_id uuid not null references public.broadcast_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('invite','press')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  primary key(session_id,user_id)
);
alter table public.broadcast_session_grants enable row level security;
revoke all on public.broadcast_session_grants from public, anon, authenticated;
grant select, insert, update, delete on public.broadcast_session_grants to service_role;
alter table public.broadcast_session_events enable row level security;
revoke all on public.broadcast_sessions, public.broadcast_session_events from anon, authenticated;
grant select, insert, update on public.broadcast_sessions to service_role;
grant select, insert on public.broadcast_session_events to service_role;

-- Trusted server reducer validates commands; this transaction owns ordering, time,
-- host ownership, compare-and-swap and idempotency. It is never executable by a browser.
create function public.commit_broadcast_command(
  p_session_id uuid, p_actor_id uuid, p_command_id uuid, p_fingerprint text,
  p_expected_sequence bigint, p_command_type text, p_snapshot jsonb, p_proposed_at double precision
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  current_row public.broadcast_sessions%rowtype;
  previous_event public.broadcast_session_events%rowtype;
  committed jsonb;
  issued_ms double precision;
  adjustment double precision;
  track_duration double precision;
  event_id uuid := gen_random_uuid();
begin
  select * into current_row from public.broadcast_sessions where id = p_session_id for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if current_row.host_id is distinct from p_actor_id then return jsonb_build_object('error', 'FORBIDDEN'); end if;
  select * into previous_event from public.broadcast_session_events
    where session_id = p_session_id and command_id = p_command_id;
  if found then
    if previous_event.command_fingerprint <> p_fingerprint then
      return jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object('session', current_row.snapshot, 'eventId', previous_event.id, 'duplicate', true);
  end if;
  if current_row.sequence <> p_expected_sequence then
    return jsonb_build_object('error', 'SEQUENCE_CONFLICT', 'session', current_row.snapshot);
  end if;
  if current_row.snapshot->>'state' = 'ENDED' then return jsonb_build_object('error', 'SESSION_ENDED'); end if;
  if p_snapshot->>'id' is distinct from p_session_id::text
    or (p_snapshot->>'sequence')::bigint is distinct from current_row.sequence + 1
    or p_snapshot->'type' is distinct from current_row.snapshot->'type'
    or p_snapshot->'releaseId' is distinct from current_row.snapshot->'releaseId'
    or p_snapshot->'productId' is distinct from current_row.snapshot->'productId' then
    raise exception 'Invalid Broadcast snapshot identity';
  end if;
  issued_ms := extract(epoch from clock_timestamp()) * 1000;
  if p_proposed_at is null or not (p_proposed_at between issued_ms - 10000 and issued_ms + 10000) then
    return jsonb_build_object('error', 'CLOCK_CONFLICT');
  end if;
  committed := p_snapshot || jsonb_build_object('updatedAt', issued_ms);
  -- Rebase transport-changing commands to the actual transaction time. Presentation
  -- and order-only changes keep the prior media anchor exactly as it was.
  if p_command_type in ('CUE_TRACK','START_TRACK','RESUME_TRACK','NEXT_TRACK','PREVIOUS_TRACK',
    'PAUSE_TRACK','END_TRACK','START_COMMENTARY','START_REACTION','INTERMISSION','FINALE','AFTERSHOW','END_SESSION') then
    committed := committed || jsonb_build_object('effectiveAt', issued_ms);
    if p_command_type in ('PAUSE_TRACK','END_TRACK','START_COMMENTARY','START_REACTION','INTERMISSION','FINALE','AFTERSHOW','END_SESSION')
      and (current_row.snapshot->>'isPlaying')::boolean then
      -- Compute from the prior database anchor, not the application clock.
      -- Rebasing an already-computed application position retains clock skew.
      adjustment := greatest(0, issued_ms - (current_row.snapshot->>'effectiveAt')::double precision) / 1000
        + (current_row.snapshot->>'mediaPosition')::double precision;
      select (item->>'durationSeconds')::double precision into track_duration
        from jsonb_array_elements(current_row.snapshot->'items') item
        where item->>'id' = current_row.snapshot->>'currentItemId' limit 1;
      if track_duration > 0 then adjustment := least(adjustment, track_duration); end if;
      committed := committed || jsonb_build_object('mediaPosition', adjustment);
    end if;
  end if;
  if p_command_type = 'GO_LIVE' then committed := committed || jsonb_build_object('startedAt', issued_ms); end if;
  if p_command_type = 'END_SESSION' then committed := committed || jsonb_build_object('endedAt', issued_ms); end if;
  if p_command_type = 'VISUAL_CUE' then
    committed := jsonb_set(committed, '{visualCue,effectiveAt}', to_jsonb(issued_ms));
  end if;
  update public.broadcast_sessions set snapshot = committed, sequence = current_row.sequence + 1,
    updated_at = to_timestamp(issued_ms / 1000) where id = p_session_id;
  insert into public.broadcast_session_events(id, session_id, command_id, command_fingerprint,
    sequence, actor_id, command_type, issued_at, snapshot)
    values(event_id, p_session_id, p_command_id, p_fingerprint, current_row.sequence + 1,
      p_actor_id, p_command_type, to_timestamp(issued_ms / 1000), committed);
  return jsonb_build_object('session', committed, 'eventId', event_id, 'duplicate', false);
end $$;
revoke all on function public.commit_broadcast_command(uuid,uuid,uuid,text,bigint,text,jsonb,double precision) from public, anon, authenticated;
grant execute on function public.commit_broadcast_command(uuid,uuid,uuid,text,bigint,text,jsonb,double precision) to service_role;
commit;
