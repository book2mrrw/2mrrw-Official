-- F0: fenced deferral for lifecycle work that must wait for a future deadline.

create or replace function public.defer_account_lifecycle_step(
  p_request_id uuid,
  p_step_key text,
  p_lease_token uuid,
  p_resume_at timestamptz,
  p_reason text
) returns boolean
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_resume_at <= now() or p_resume_at > now() + interval '366 days' then
    raise exception 'invalid resume time' using errcode='22023';
  end if;
  update public.account_lifecycle_steps
     set status='pending', next_attempt_at=p_resume_at,
         attempt_count=greatest(0,attempt_count-1),
         lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=now(),
         last_error_code=null
   where request_id=p_request_id and step_key=p_step_key and status='processing'
     and lease_token=p_lease_token and lease_expires_at > now();
  if not found then return false; end if;
  update public.account_lifecycle_requests
     set status='ready',lease_owner=null,lease_expires_at=null,updated_at=now()
   where id=p_request_id;
  insert into public.account_lifecycle_events(request_id,event_type,actor_type,correlation_id,detail)
  values(p_request_id,'step_deferred','service',gen_random_uuid(),
    jsonb_build_object('step_key',p_step_key,'resume_at',p_resume_at,'reason',left(coalesce(p_reason,'scheduled'),128)));
  return true;
end $$;

revoke all on function public.defer_account_lifecycle_step(uuid,text,uuid,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.defer_account_lifecycle_step(uuid,text,uuid,timestamptz,text)
  to service_role;
