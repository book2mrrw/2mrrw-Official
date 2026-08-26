-- F0: atomic capability revocation and terminal identity-deletion preflight.

create or replace function public.revoke_account_capabilities(
  p_request_id uuid, p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid; v_count bigint:=0; v_rows bigint;
begin
  v_user:=public.lifecycle_assert_step_lease(p_request_id,'revoke_entitlements_and_sessions',p_lease_token);
  delete from public.access_tokens where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.library_items where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.entitlements where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.user_entitlements where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.vault_entitlements where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.collector_access where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.gift_redemptions where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.admin_principals where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  update public.memberships set status='canceled',canceled_at=coalesce(canceled_at,now()),updated_at=now()
    where user_id=v_user and status <> 'canceled';
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  return jsonb_build_object('capability_rows_revoked',v_count);
end $$;

create or replace function public.preflight_account_auth_deletion(
  p_request_id uuid, p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid; v_blockers bigint;
begin
  v_user:=public.lifecycle_assert_step_lease(p_request_id,'delete_auth_identity',p_lease_token);
  select
    (select count(*) from public.purchases where user_id=v_user) +
    (select count(*) from public.gift_transactions where purchaser_user_id=v_user) +
    (select count(*) from public.collector_ownerships where user_id=v_user) +
    (select count(*) from public.collector_claims where user_id=v_user) +
    (select count(*) from public.access_tokens where user_id=v_user) +
    (select count(*) from public.library_items where user_id=v_user) +
    (select count(*) from public.entitlements where user_id=v_user) +
    (select count(*) from public.user_entitlements where user_id=v_user)
  into v_blockers;
  if v_blockers > 0 then raise exception 'auth deletion blocked by % live identity references',v_blockers using errcode='23503'; end if;
  return jsonb_build_object('safe_to_delete',true,'user_id',v_user);
end $$;

revoke all on function public.revoke_account_capabilities(uuid,uuid) from public,anon,authenticated;
revoke all on function public.preflight_account_auth_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_account_capabilities(uuid,uuid) to service_role;
grant execute on function public.preflight_account_auth_deletion(uuid,uuid) to service_role;
