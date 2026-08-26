-- F0: atomic, fenced account-lifecycle worker contract.
-- Only service_role may claim or mutate saga execution state.

alter table public.account_lifecycle_steps
  add column if not exists lease_token uuid,
  add column if not exists max_attempts integer not null default 8
    check (max_attempts between 1 and 32);

-- The lifecycle evidence must survive deletion of auth.users. The UUID remains an
-- internal correlation value; access remains service-role-only after the subject is gone.
alter table public.account_lifecycle_requests
  alter column user_id drop not null;

alter table public.account_lifecycle_requests
  drop constraint if exists account_lifecycle_requests_user_id_fkey;

alter table public.account_lifecycle_requests
  add constraint account_lifecycle_requests_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create or replace function public.claim_account_lifecycle_step(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns table (
  request_id uuid,
  user_id uuid,
  kind text,
  step_key text,
  attempt_count integer,
  lease_token uuid,
  correlation_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_step record;
  v_token uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_worker_id)), 0) < 3 then
    raise exception 'worker id required' using errcode = '22023';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;

  -- Promote elapsed cooling-off requests, and release expired request leases.
  update public.account_lifecycle_requests
     set status = 'ready', updated_at = now()
   where status = 'cooling_off' and execute_after <= now();

  select s.request_id, s.step_key
    into v_step
    from public.account_lifecycle_steps s
    join public.account_lifecycle_requests r on r.id = s.request_id
   where r.status in ('ready', 'processing')
     and r.execute_after <= now()
     and not exists (
       select 1 from public.account_lifecycle_holds h
        where h.request_id = r.id and h.released_at is null
          and (h.retain_until is null or h.retain_until > now())
     )
     and s.status in ('pending', 'processing')
     and s.next_attempt_at <= now()
     and (s.status = 'pending' or s.lease_expires_at <= now())
     and s.attempt_count < s.max_attempts
     and not exists (
       select 1 from public.account_lifecycle_steps prior
        where prior.request_id = s.request_id
          and prior.ordinal < s.ordinal
          and prior.status not in ('completed', 'skipped')
     )
   order by r.requested_at, s.ordinal
   for update of s skip locked
   limit 1;

  if not found then return; end if;

  update public.account_lifecycle_steps s
     set status = 'processing', attempt_count = s.attempt_count + 1,
         lease_owner = p_worker_id, lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(s.started_at, now()), updated_at = now()
   where s.request_id = v_step.request_id and s.step_key = v_step.step_key;

  update public.account_lifecycle_requests r
     set status = 'processing', lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = r.attempt_count + 1, updated_at = now()
   where r.id = v_step.request_id;

  insert into public.account_lifecycle_events(
    request_id, event_type, actor_type, correlation_id, detail
  ) values (
    v_step.request_id, 'step_claimed', 'service', v_correlation,
    jsonb_build_object('step_key', v_step.step_key, 'worker_id', p_worker_id, 'lease_token', v_token)
  );

  return query
  select r.id, r.user_id, r.kind, s.step_key, s.attempt_count,
         s.lease_token, v_correlation
    from public.account_lifecycle_requests r
    join public.account_lifecycle_steps s on s.request_id = r.id
   where r.id = v_step.request_id and s.step_key = v_step.step_key;
end $$;

create or replace function public.finish_account_lifecycle_step(
  p_request_id uuid,
  p_step_key text,
  p_lease_token uuid,
  p_result jsonb default '{}'::jsonb,
  p_skipped boolean default false
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_done boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  update public.account_lifecycle_steps
     set status = case when p_skipped then 'skipped' else 'completed' end,
         result = coalesce(p_result, '{}'::jsonb), completed_at = now(), updated_at = now(),
         lease_owner = null, lease_token = null, lease_expires_at = null, last_error_code = null
   where request_id = p_request_id and step_key = p_step_key
     and status = 'processing' and lease_token = p_lease_token and lease_expires_at > now();
  if not found then return false; end if;

  select not exists (
    select 1 from public.account_lifecycle_steps
     where request_id = p_request_id and status not in ('completed','skipped')
  ) into v_done;

  update public.account_lifecycle_requests
     set status = case when v_done then 'completed' else 'ready' end,
         completed_at = case when v_done then now() else completed_at end,
         lease_owner = null, lease_expires_at = null, updated_at = now()
   where id = p_request_id;

  insert into public.account_lifecycle_events(request_id,event_type,actor_type,correlation_id,detail)
  values(p_request_id, case when v_done then 'completed' else 'step_completed' end,
         'service', gen_random_uuid(), jsonb_build_object('step_key',p_step_key,'skipped',p_skipped));
  return true;
end $$;

create or replace function public.retry_account_lifecycle_step(
  p_request_id uuid,
  p_step_key text,
  p_lease_token uuid,
  p_error_code text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_attempt integer; v_max integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select attempt_count, max_attempts into v_attempt, v_max
    from public.account_lifecycle_steps
   where request_id=p_request_id and step_key=p_step_key and status='processing'
     and lease_token=p_lease_token and lease_expires_at > now()
   for update;
  if not found then return false; end if;

  update public.account_lifecycle_steps
     set status = case when v_attempt >= v_max then 'failed' else 'pending' end,
         next_attempt_at = now() + make_interval(secs => least(21600, 30 * power(2, least(v_attempt - 1, 10))::integer)),
         last_error_code = left(coalesce(p_error_code,'unknown'),128),
         lease_owner=null, lease_token=null, lease_expires_at=null, updated_at=now()
   where request_id=p_request_id and step_key=p_step_key;

  update public.account_lifecycle_requests
     set status=case when v_attempt >= v_max then 'failed' else 'ready' end,
         failure_code=case when v_attempt >= v_max then left(coalesce(p_error_code,'unknown'),128) else null end,
         lease_owner=null, lease_expires_at=null, updated_at=now()
   where id=p_request_id;

  insert into public.account_lifecycle_events(request_id,event_type,actor_type,correlation_id,detail)
  values(p_request_id,case when v_attempt >= v_max then 'step_exhausted' else 'step_retry_scheduled' end,
         'service',gen_random_uuid(),jsonb_build_object('step_key',p_step_key,'attempt',v_attempt,'error_code',left(coalesce(p_error_code,'unknown'),128)));
  return true;
end $$;

revoke all on function public.claim_account_lifecycle_step(text,integer) from public, anon, authenticated;
revoke all on function public.finish_account_lifecycle_step(uuid,text,uuid,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.retry_account_lifecycle_step(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_account_lifecycle_step(text,integer) to service_role;
grant execute on function public.finish_account_lifecycle_step(uuid,text,uuid,jsonb,boolean) to service_role;
grant execute on function public.retry_account_lifecycle_step(uuid,text,uuid,text) to service_role;

comment on function public.claim_account_lifecycle_step(text,integer) is
  'Claims one ordered lifecycle step with SKIP LOCKED and a fencing token.';
