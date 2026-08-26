-- F0: atomic export delivery evidence and cryptographic-erasure state.

create or replace function public.mark_account_export_delivered(p_artifact_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  update public.account_export_artifacts set delivered_at=coalesce(delivered_at,now())
   where id=p_artifact_id and destroyed_at is null and expires_at > now();
  return found;
end $$;

create or replace function public.destroy_account_export_artifact(p_artifact_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  update public.account_export_artifacts
     set destroyed_at=coalesce(destroyed_at,now()), wrapped_data_key='DESTROYED'
   where id=p_artifact_id and destroyed_at is null;
  return found;
end $$;

revoke all on function public.mark_account_export_delivered(uuid) from public,anon,authenticated;
revoke all on function public.destroy_account_export_artifact(uuid) from public,anon,authenticated;
grant execute on function public.mark_account_export_delivered(uuid) to service_role;
grant execute on function public.destroy_account_export_artifact(uuid) to service_role;
