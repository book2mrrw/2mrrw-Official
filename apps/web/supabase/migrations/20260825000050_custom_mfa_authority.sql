-- E1-M: durable, opaque, server-controlled custom MFA authority.
begin;

create table if not exists public.mfa_authority_generations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation bigint not null default 1 check (generation > 0),
  updated_at timestamptz not null default now(), update_reason text
);
create table if not exists public.mfa_authority_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  auth_session_id text not null, generation bigint not null check (generation > 0),
  verified_at timestamptz not null default now(), expires_at timestamptz not null,
  revoked_at timestamptz, revoke_reason text, created_at timestamptz not null default now(),
  check (expires_at > verified_at)
);
create index if not exists mfa_authority_sessions_user_active_idx
  on public.mfa_authority_sessions(user_id,auth_session_id,expires_at) where revoked_at is null;
create table if not exists public.mfa_authority_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  authority_id uuid references public.mfa_authority_sessions(id) on delete set null,
  event_type text not null, generation bigint, occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists mfa_authority_events_user_time_idx
  on public.mfa_authority_events(user_id,occurred_at desc);

alter table public.mfa_authority_generations enable row level security;
alter table public.mfa_authority_sessions enable row level security;
alter table public.mfa_authority_events enable row level security;
revoke all on public.mfa_authority_generations,public.mfa_authority_sessions,public.mfa_authority_events
  from public,anon,authenticated;
grant select,insert,update,delete on public.mfa_authority_generations,public.mfa_authority_sessions to service_role;
grant select,insert on public.mfa_authority_events to service_role;
grant usage,select on sequence public.mfa_authority_events_id_seq to service_role;

create or replace function public.issue_2mrrw_mfa_authority(
  p_user_id uuid,p_token_hash text,p_auth_session_id text,p_ttl_seconds integer
) returns table(authority_id uuid,generation bigint,verified_at timestamptz,expires_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_generation bigint; v_row public.mfa_authority_sessions;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_user_id is null or coalesce(length(p_auth_session_id),0)<8 or p_token_hash !~ '^[0-9a-f]{64}$'
    then raise exception 'invalid MFA authority binding' using errcode='22023'; end if;
  if p_ttl_seconds not between 300 and 86400
    then raise exception 'invalid MFA authority lifetime' using errcode='22023'; end if;
  insert into public.mfa_authority_generations(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select g.generation into v_generation from public.mfa_authority_generations g
    where g.user_id=p_user_id for update;
  update public.mfa_authority_sessions set revoked_at=now(),revoke_reason='superseded_for_auth_session'
    where user_id=p_user_id and auth_session_id=p_auth_session_id and revoked_at is null;
  insert into public.mfa_authority_sessions(user_id,token_hash,auth_session_id,generation,expires_at)
    values(p_user_id,p_token_hash,p_auth_session_id,v_generation,now()+make_interval(secs=>p_ttl_seconds))
    returning * into v_row;
  insert into public.mfa_authority_events(user_id,authority_id,event_type,generation)
    values(p_user_id,v_row.id,'issued_after_otp',v_generation);
  return query select v_row.id,v_generation,v_row.verified_at,v_row.expires_at;
end $$;

create or replace function public.verify_2mrrw_mfa_authority(
  p_user_id uuid,p_token_hash text,p_auth_session_id text
) returns table(authority_id uuid,generation bigint,verified_at timestamptz,expires_at timestamptz)
language sql security definer stable set search_path=public,pg_temp as $$
  select s.id,s.generation,s.verified_at,s.expires_at
  from public.mfa_authority_sessions s join public.mfa_authority_generations g on g.user_id=s.user_id
  where auth.role()='service_role' and s.user_id=p_user_id and s.token_hash=p_token_hash
    and s.auth_session_id=p_auth_session_id and s.generation=g.generation
    and s.revoked_at is null and s.expires_at>now() limit 1
$$;

create or replace function public.revoke_2mrrw_mfa_authority(p_token_hash text,p_reason text default 'sign_out')
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.mfa_authority_sessions;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  update public.mfa_authority_sessions set revoked_at=coalesce(revoked_at,now()),
    revoke_reason=coalesce(revoke_reason,left(coalesce(p_reason,'revoked'),128))
    where token_hash=p_token_hash returning * into v_row;
  if not found then return false; end if;
  insert into public.mfa_authority_events(user_id,authority_id,event_type,generation,detail)
    values(v_row.user_id,v_row.id,'revoked',v_row.generation,
      jsonb_build_object('reason',left(coalesce(p_reason,'revoked'),128)));
  return true;
end $$;

create or replace function public.bump_2mrrw_mfa_generation(p_user_id uuid,p_reason text)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v_generation bigint;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  insert into public.mfa_authority_generations(user_id,generation,update_reason)
    values(p_user_id,2,left(coalesce(p_reason,'security_reset'),128))
  on conflict(user_id) do update set generation=public.mfa_authority_generations.generation+1,
    updated_at=now(),update_reason=excluded.update_reason returning generation into v_generation;
  update public.mfa_authority_sessions set revoked_at=coalesce(revoked_at,now()),
    revoke_reason=coalesce(revoke_reason,'generation_bumped') where user_id=p_user_id and revoked_at is null;
  insert into public.mfa_authority_events(user_id,event_type,generation,detail)
    values(p_user_id,'generation_bumped',v_generation,
      jsonb_build_object('reason',left(coalesce(p_reason,'security_reset'),128)));
  return v_generation;
end $$;

revoke all on function public.issue_2mrrw_mfa_authority(uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.verify_2mrrw_mfa_authority(uuid,text,text) from public,anon,authenticated;
revoke all on function public.revoke_2mrrw_mfa_authority(text,text) from public,anon,authenticated;
revoke all on function public.bump_2mrrw_mfa_generation(uuid,text) from public,anon,authenticated;
grant execute on function public.issue_2mrrw_mfa_authority(uuid,text,text,integer) to service_role;
grant execute on function public.verify_2mrrw_mfa_authority(uuid,text,text) to service_role;
grant execute on function public.revoke_2mrrw_mfa_authority(text,text) to service_role;
grant execute on function public.bump_2mrrw_mfa_generation(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
