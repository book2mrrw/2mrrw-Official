-- F0: preserve regulated evidence pseudonymously; erase ephemeral account data atomically.

alter table public.purchases add column if not exists lifecycle_subject_ref text;
alter table public.purchases alter column user_id drop not null;
alter table public.purchases drop constraint if exists purchases_user_id_fkey;
alter table public.purchases add constraint purchases_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;

alter table public.gift_transactions add column if not exists lifecycle_subject_ref text;
alter table public.gift_transactions alter column purchaser_user_id drop not null;
alter table public.gift_transactions drop constraint if exists gift_transactions_purchaser_user_id_fkey;
alter table public.gift_transactions add constraint gift_transactions_purchaser_user_id_fkey foreign key(purchaser_user_id) references auth.users(id) on delete set null;

alter table public.collector_ownerships add column if not exists lifecycle_subject_ref text;
alter table public.collector_ownerships alter column user_id drop not null;
alter table public.collector_ownerships drop constraint if exists collector_ownerships_user_id_fkey;
alter table public.collector_ownerships add constraint collector_ownerships_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;

alter table public.collector_claims add column if not exists lifecycle_subject_ref text;
alter table public.collector_claims alter column user_id drop not null;
alter table public.collector_claims drop constraint if exists collector_claims_user_id_fkey;
alter table public.collector_claims add constraint collector_claims_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;

create index if not exists purchases_lifecycle_subject_idx on public.purchases(lifecycle_subject_ref) where lifecycle_subject_ref is not null;
create index if not exists gift_transactions_lifecycle_subject_idx on public.gift_transactions(lifecycle_subject_ref) where lifecycle_subject_ref is not null;
create index if not exists collector_ownerships_lifecycle_subject_idx on public.collector_ownerships(lifecycle_subject_ref) where lifecycle_subject_ref is not null;
create index if not exists collector_claims_lifecycle_subject_idx on public.collector_claims(lifecycle_subject_ref) where lifecycle_subject_ref is not null;

create or replace function public.lifecycle_assert_step_lease(
  p_request_id uuid, p_step_key text, p_lease_token uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select r.user_id into v_user_id from public.account_lifecycle_requests r
  join public.account_lifecycle_steps s on s.request_id=r.id
  where r.id=p_request_id and r.kind='delete' and r.status='processing'
    and s.step_key=p_step_key and s.status='processing'
    and s.lease_token=p_lease_token and s.lease_expires_at > now()
  for update of r,s;
  if v_user_id is null then raise exception 'valid lifecycle step lease required' using errcode='42501'; end if;
  return v_user_id;
end $$;

create or replace function public.erase_account_ephemeral_data(
  p_request_id uuid, p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid; v_count bigint:=0; v_rows bigint;
begin
  v_user:=public.lifecycle_assert_step_lease(p_request_id,'erase_ephemeral_data',p_lease_token);
  delete from public.login_otp where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.stream_sessions where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.stream_events where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.media_playback_progress where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.notification_push_subscriptions where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.notification_delivery_logs where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.notification_inbox where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.notification_preferences where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  delete from public.vault_content_progress where user_id=v_user; get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  return jsonb_build_object('rows_erased',v_count);
end $$;

create or replace function public.anonymize_account_retained_records(
  p_request_id uuid, p_lease_token uuid, p_subject_ref text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid; v_count bigint:=0; v_rows bigint;
begin
  if p_subject_ref !~ '^acct_[a-f0-9]{64}$' then raise exception 'invalid pseudonymous subject reference' using errcode='22023'; end if;
  v_user:=public.lifecycle_assert_step_lease(p_request_id,'anonymize_retained_records',p_lease_token);
  update public.purchases set user_id=null,lifecycle_subject_ref=p_subject_ref,receipt_url=null where user_id=v_user;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  update public.gift_transactions set purchaser_user_id=null,lifecycle_subject_ref=p_subject_ref,
    recipient_email='redacted@invalid',redeem_token_hash=null,metadata='{"redacted":true}'::jsonb where purchaser_user_id=v_user;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  update public.collector_ownerships set user_id=null,lifecycle_subject_ref=p_subject_ref,
    customer_email=null,customer_phone=null,shipping_name=null,shipping_country=null,
    shipping_state=null,shipping_city=null,shipping_postal_code=null,
    shipping_address_line1=null,shipping_address_line2=null,metadata='{"redacted":true}'::jsonb where user_id=v_user;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  update public.collector_claims set user_id=null,lifecycle_subject_ref=p_subject_ref,
    device_info='{}'::jsonb,ip_hash=null,metadata='{"redacted":true}'::jsonb where user_id=v_user;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  update public.fulfillment_orders f set request_payload='{"redacted":true}'::jsonb,
    response_payload='{"redacted":true}'::jsonb,error_message=null
   where exists(select 1 from public.purchases p where p.id=f.purchase_id and p.lifecycle_subject_ref=p_subject_ref);
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  return jsonb_build_object('rows_anonymized',v_count,'subject_ref',p_subject_ref);
end $$;

revoke all on function public.lifecycle_assert_step_lease(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.erase_account_ephemeral_data(uuid,uuid) from public,anon,authenticated;
revoke all on function public.anonymize_account_retained_records(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.lifecycle_assert_step_lease(uuid,text,uuid) to service_role;
grant execute on function public.erase_account_ephemeral_data(uuid,uuid) to service_role;
grant execute on function public.anonymize_account_retained_records(uuid,uuid,text) to service_role;
