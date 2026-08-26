-- F0: exact-key, reference-aware registry for personal (never catalog) objects.

create table if not exists public.account_owned_storage_objects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  lifecycle_subject_ref text,
  provider text not null check(provider in ('r2','supabase')),
  bucket text not null,
  object_key text not null,
  purpose text not null check(purpose in ('avatar','account_attachment','support_attachment','personal_export')),
  reference_count integer not null default 1 check(reference_count >= 0),
  state text not null default 'active' check(state in ('active','delete_claimed','deleted','retained')),
  lease_token uuid,
  lease_expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,bucket,object_key),
  check((state='delete_claimed')=(lease_token is not null))
);
create index if not exists account_storage_owner_idx on public.account_owned_storage_objects(owner_user_id,state);
alter table public.account_owned_storage_objects enable row level security;
revoke all on public.account_owned_storage_objects from public,anon,authenticated;

create or replace function public.claim_account_storage_deletions(
  p_request_id uuid,p_step_lease_token uuid,p_limit integer default 100
) returns table(id uuid,provider text,bucket text,object_key text,object_lease_token uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid;
begin
  v_user:=public.lifecycle_assert_step_lease(p_request_id,'erase_storage_objects',p_step_lease_token);
  if p_limit not between 1 and 500 then raise exception 'invalid claim limit' using errcode='22023'; end if;
  return query
  with candidates as (
    select o.id from public.account_owned_storage_objects o
    where o.owner_user_id=v_user and o.reference_count=0
      and (o.state='active' or (o.state='delete_claimed' and o.lease_expires_at <= now()))
    order by o.created_at for update skip locked limit p_limit
  ), claimed as (
    update public.account_owned_storage_objects o set state='delete_claimed',
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now()
    from candidates c where o.id=c.id
    returning o.id,o.provider,o.bucket,o.object_key,o.lease_token
  ) select claimed.id,claimed.provider,claimed.bucket,claimed.object_key,claimed.lease_token from claimed;
end $$;

create or replace function public.finish_account_storage_deletion(
  p_object_id uuid,p_object_lease_token uuid,p_subject_ref text
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  update public.account_owned_storage_objects set state='deleted',owner_user_id=null,
    lifecycle_subject_ref=p_subject_ref,reference_count=0,deleted_at=now(),
    lease_token=null,lease_expires_at=null,updated_at=now()
  where id=p_object_id and state='delete_claimed' and lease_token=p_object_lease_token
    and lease_expires_at > now() and reference_count=0;
  return found;
end $$;

create or replace function public.count_account_storage_blockers(
  p_request_id uuid,p_step_lease_token uuid
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid; v_count integer;
begin
  v_user:=public.lifecycle_assert_step_lease(p_request_id,'erase_storage_objects',p_step_lease_token);
  select count(*) into v_count from public.account_owned_storage_objects
   where owner_user_id=v_user and state <> 'deleted';
  return v_count;
end $$;

revoke all on function public.claim_account_storage_deletions(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.finish_account_storage_deletion(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.count_account_storage_blockers(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_account_storage_deletions(uuid,uuid,integer) to service_role;
grant execute on function public.finish_account_storage_deletion(uuid,uuid,text) to service_role;
grant execute on function public.count_account_storage_blockers(uuid,uuid) to service_role;

comment on table public.account_owned_storage_objects is
  'Exact personal-object ownership registry. Catalog/release media must never be registered here.';
