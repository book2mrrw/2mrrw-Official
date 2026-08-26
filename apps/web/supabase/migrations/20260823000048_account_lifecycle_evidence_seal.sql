-- F0: immutable, atomic terminal evidence seal.

create table if not exists public.account_lifecycle_seals (
  request_id uuid primary key references public.account_lifecycle_requests(id) on delete restrict,
  evidence_version integer not null default 1,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  step_count integer not null,
  event_count integer not null,
  sealed_at timestamptz not null default now()
);
alter table public.account_lifecycle_seals enable row level security;
revoke all on public.account_lifecycle_seals from public,anon,authenticated;

create or replace function public.prevent_lifecycle_seal_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'account lifecycle seals are immutable' using errcode='55000'; end $$;
drop trigger if exists account_lifecycle_seals_immutable on public.account_lifecycle_seals;
create trigger account_lifecycle_seals_immutable before update or delete on public.account_lifecycle_seals
for each row execute function public.prevent_lifecycle_seal_mutation();

create or replace function public.seal_account_lifecycle(
  p_request_id uuid,p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_digest text; v_steps integer; v_events integer; v_evidence jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  perform 1 from public.account_lifecycle_steps s join public.account_lifecycle_requests r on r.id=s.request_id
   where r.id=p_request_id and r.status='processing' and s.step_key='seal_evidence'
     and s.status='processing' and s.lease_token=p_lease_token and s.lease_expires_at > now()
   for update of r,s;
  if not found then raise exception 'valid seal lease required' using errcode='42501'; end if;
  if exists(select 1 from public.account_lifecycle_steps where request_id=p_request_id
    and step_key <> 'seal_evidence' and status not in ('completed','skipped')) then
    raise exception 'lifecycle steps remain incomplete' using errcode='55000';
  end if;

  select jsonb_build_object(
    'version',1,
    'request',(select to_jsonb(r)-'lease_owner'-'lease_expires_at' from public.account_lifecycle_requests r where r.id=p_request_id),
    'steps',(select coalesce(jsonb_agg(to_jsonb(s)-'lease_owner'-'lease_token'-'lease_expires_at' order by s.ordinal),'[]'::jsonb) from public.account_lifecycle_steps s where s.request_id=p_request_id and s.step_key <> 'seal_evidence'),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.account_lifecycle_events e where e.request_id=p_request_id)
  ) into v_evidence;
  select count(*) into v_steps from public.account_lifecycle_steps where request_id=p_request_id;
  select count(*) into v_events from public.account_lifecycle_events where request_id=p_request_id;
  v_digest:=encode(digest(convert_to(v_evidence::text,'UTF8'),'sha256'),'hex');

  insert into public.account_lifecycle_seals(request_id,evidence_sha256,step_count,event_count)
  values(p_request_id,v_digest,v_steps,v_events) on conflict(request_id) do nothing;
  update public.account_lifecycle_steps set status='completed',result=jsonb_build_object('evidence_sha256',v_digest),
    completed_at=now(),updated_at=now(),lease_owner=null,lease_token=null,lease_expires_at=null
   where request_id=p_request_id and step_key='seal_evidence';
  update public.account_lifecycle_requests set status='completed',completed_at=now(),updated_at=now(),
    lease_owner=null,lease_expires_at=null where id=p_request_id;
  insert into public.account_lifecycle_events(request_id,event_type,actor_type,correlation_id,detail)
  values(p_request_id,'evidence_sealed','system',gen_random_uuid(),jsonb_build_object('evidence_sha256',v_digest));
  return jsonb_build_object('committed',true,'evidence_sha256',v_digest,'step_count',v_steps,'event_count',v_events);
end $$;

revoke all on function public.seal_account_lifecycle(uuid,uuid) from public,anon,authenticated;
grant execute on function public.seal_account_lifecycle(uuid,uuid) to service_role;
