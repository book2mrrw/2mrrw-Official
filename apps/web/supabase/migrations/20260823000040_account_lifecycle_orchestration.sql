-- F0: durable, resumable account export/deletion orchestration.
-- Requests are append-audited sagas. No client can advance execution state.

create table if not exists public.account_lifecycle_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('export','delete')),
  status text not null default 'cooling_off' check (status in (
    'cooling_off','held','ready','processing','completed','cancelled','failed'
  )),
  idempotency_key uuid not null,
  requested_at timestamptz not null default now(),
  execute_after timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, idempotency_key)
);

create unique index if not exists account_lifecycle_one_active_kind
  on public.account_lifecycle_requests(user_id, kind)
  where status in ('cooling_off','held','ready','processing');
create index if not exists account_lifecycle_ready_idx
  on public.account_lifecycle_requests(status, execute_after, lease_expires_at);

create table if not exists public.account_lifecycle_holds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_lifecycle_requests(id) on delete cascade,
  category text not null,
  reason text not null,
  retain_until timestamptz,
  source_reference text,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists account_lifecycle_active_hold
  on public.account_lifecycle_holds(request_id, category)
  where released_at is null;

create table if not exists public.account_lifecycle_steps (
  request_id uuid not null references public.account_lifecycle_requests(id) on delete cascade,
  step_key text not null,
  ordinal integer not null check (ordinal > 0),
  status text not null default 'pending' check (status in ('pending','processing','completed','skipped','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  last_error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (request_id, step_key),
  unique (request_id, ordinal)
);
create index if not exists account_lifecycle_step_claim_idx
  on public.account_lifecycle_steps(status, next_attempt_at, lease_expires_at, ordinal);

create table if not exists public.account_lifecycle_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.account_lifecycle_requests(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('user','admin','service','system')),
  actor_id uuid,
  correlation_id uuid not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists account_lifecycle_events_request_idx
  on public.account_lifecycle_events(request_id, id);

alter table public.account_lifecycle_requests enable row level security;
alter table public.account_lifecycle_holds enable row level security;
alter table public.account_lifecycle_steps enable row level security;
alter table public.account_lifecycle_events enable row level security;

revoke all on public.account_lifecycle_requests, public.account_lifecycle_holds,
  public.account_lifecycle_steps, public.account_lifecycle_events from public, anon, authenticated;
grant select on public.account_lifecycle_requests to authenticated;

drop policy if exists account_lifecycle_select_own on public.account_lifecycle_requests;
create policy account_lifecycle_select_own on public.account_lifecycle_requests
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.request_account_lifecycle(
  p_kind text,
  p_idempotency_key uuid,
  p_correlation_id uuid
) returns public.account_lifecycle_requests
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.account_lifecycle_requests;
  v_delay interval;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_kind not in ('export','delete') then raise exception 'invalid lifecycle kind' using errcode='22023'; end if;
  if p_idempotency_key is null or p_correlation_id is null then raise exception 'request ids required' using errcode='22023'; end if;
  v_delay := case when p_kind = 'delete' then interval '14 days' else interval '0 seconds' end;

  insert into public.account_lifecycle_requests(user_id, kind, status, idempotency_key, execute_after)
  values (v_user_id, p_kind, case when v_delay = interval '0 seconds' then 'ready' else 'cooling_off' end,
          p_idempotency_key, now() + v_delay)
  on conflict (user_id, kind, idempotency_key) do update set updated_at = now()
  returning * into v_request;

  if not exists (select 1 from public.account_lifecycle_steps where request_id=v_request.id) then
    if p_kind = 'export' then
      insert into public.account_lifecycle_steps(request_id, step_key, ordinal) values
        (v_request.id,'snapshot_export',10),
        (v_request.id,'deliver_export',20),
        (v_request.id,'expire_export_artifact',30),
        (v_request.id,'seal_evidence',40);
    else
      insert into public.account_lifecycle_steps(request_id, step_key, ordinal) values
        (v_request.id,'freeze_identity',10),
        (v_request.id,'snapshot_export',20),
        (v_request.id,'cancel_subscriptions',30),
        (v_request.id,'classify_retention',40),
        (v_request.id,'erase_ephemeral_data',50),
        (v_request.id,'anonymize_retained_records',60),
        (v_request.id,'erase_storage_objects',70),
        (v_request.id,'notify_external_processors',80),
        (v_request.id,'revoke_entitlements_and_sessions',90),
        (v_request.id,'delete_auth_identity',100),
        (v_request.id,'seal_evidence',110);
    end if;
  end if;
  insert into public.account_lifecycle_events(request_id,event_type,actor_type,actor_id,correlation_id)
  values(v_request.id,'requested','user',v_user_id,p_correlation_id);
  return v_request;
end $$;

create or replace function public.cancel_account_deletion(p_request_id uuid, p_correlation_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user_id uuid := auth.uid();
begin
  update public.account_lifecycle_requests set status='cancelled', cancelled_at=now(), updated_at=now()
   where id=p_request_id and user_id=v_user_id and kind='delete' and status='cooling_off';
  if not found then return false; end if;
  insert into public.account_lifecycle_events(request_id,event_type,actor_type,actor_id,correlation_id)
  values(p_request_id,'cancelled','user',v_user_id,p_correlation_id);
  return true;
end $$;

revoke all on function public.request_account_lifecycle(text,uuid,uuid) from public,anon;
grant execute on function public.request_account_lifecycle(text,uuid,uuid) to authenticated;
revoke all on function public.cancel_account_deletion(uuid,uuid) from public,anon;
grant execute on function public.cancel_account_deletion(uuid,uuid) to authenticated;

comment on table public.account_lifecycle_requests is
  'Durable account export/deletion saga. Execution is service-role only; users may request, inspect, and cancel during cooling-off.';
