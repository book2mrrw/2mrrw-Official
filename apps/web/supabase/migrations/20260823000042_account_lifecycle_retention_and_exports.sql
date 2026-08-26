-- F0: policy-driven retention, encrypted export manifests, and processor receipts.

create table if not exists public.account_retention_policies (
  policy_key text primary key,
  data_domain text not null,
  disposition text not null check (disposition in ('erase','anonymize','retain','external')),
  retention_interval interval,
  legal_basis text not null,
  policy_version integer not null default 1 check (policy_version > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check ((disposition = 'retain' and retention_interval is not null) or disposition <> 'retain')
);

create table if not exists public.account_export_artifacts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_lifecycle_requests(id) on delete cascade,
  object_key text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  encryption_algorithm text not null default 'AES-256-GCM',
  key_version text not null,
  wrapped_data_key text not null,
  manifest jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  delivered_at timestamptz,
  destroyed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create unique index if not exists account_export_one_live_artifact
  on public.account_export_artifacts(request_id)
  where destroyed_at is null;
create index if not exists account_export_expiry_idx
  on public.account_export_artifacts(expires_at)
  where destroyed_at is null;

create table if not exists public.account_processor_receipts (
  request_id uuid not null references public.account_lifecycle_requests(id) on delete cascade,
  processor_key text not null,
  operation_key text not null,
  status text not null check (status in ('pending','completed','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  remote_reference text,
  result_digest text,
  last_error_code text,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (request_id, processor_key, operation_key)
);

alter table public.account_retention_policies enable row level security;
alter table public.account_export_artifacts enable row level security;
alter table public.account_processor_receipts enable row level security;
revoke all on public.account_retention_policies, public.account_export_artifacts,
  public.account_processor_receipts from public, anon, authenticated;

insert into public.account_retention_policies
  (policy_key, data_domain, disposition, retention_interval, legal_basis)
values
  ('auth.credentials', 'authentication secrets and sessions', 'erase', null, 'account deletion'),
  ('profile.identity', 'direct profile identifiers', 'erase', null, 'account deletion'),
  ('playback.ephemeral', 'sessions, progress, and raw playback events', 'erase', null, 'data minimization'),
  ('notifications.ephemeral', 'preferences, inbox, push tokens, and delivery metadata', 'erase', null, 'data minimization'),
  ('entitlements.active', 'active digital access grants', 'erase', null, 'contract termination'),
  ('commerce.financial', 'purchase and payment evidence', 'anonymize', interval '7 years', 'tax, accounting, disputes, and fraud prevention'),
  ('collector.provenance', 'collector ownership and authenticity provenance', 'anonymize', interval '15 years', 'ownership provenance and fraud prevention'),
  ('fulfillment.records', 'physical fulfillment evidence', 'anonymize', interval '7 years', 'tax, warranty, disputes, and fraud prevention'),
  ('processors.stripe', 'Stripe customer and subscription data', 'external', null, 'processor deletion or anonymization contract'),
  ('storage.user_objects', 'user-owned private storage objects', 'erase', null, 'account deletion')
on conflict (policy_key) do nothing;

create or replace function public.record_account_processor_receipt(
  p_request_id uuid,
  p_processor_key text,
  p_operation_key text,
  p_status text,
  p_remote_reference text default null,
  p_result_digest text default null,
  p_error_code text default null
) returns public.account_processor_receipts
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_receipt public.account_processor_receipts;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if p_status not in ('pending','completed','failed') then raise exception 'invalid receipt status' using errcode='22023'; end if;
  if coalesce(length(trim(p_processor_key)),0)=0 or coalesce(length(trim(p_operation_key)),0)=0 then
    raise exception 'processor and operation keys required' using errcode='22023';
  end if;

  insert into public.account_processor_receipts(
    request_id,processor_key,operation_key,status,attempt_count,remote_reference,
    result_digest,last_error_code,completed_at
  ) values (
    p_request_id,p_processor_key,p_operation_key,p_status,1,p_remote_reference,
    p_result_digest,left(p_error_code,128),case when p_status='completed' then now() end
  )
  on conflict (request_id,processor_key,operation_key) do update set
    status = case when account_processor_receipts.status='completed' then 'completed' else excluded.status end,
    attempt_count = account_processor_receipts.attempt_count + case when account_processor_receipts.status='completed' then 0 else 1 end,
    remote_reference = coalesce(account_processor_receipts.remote_reference,excluded.remote_reference),
    result_digest = coalesce(account_processor_receipts.result_digest,excluded.result_digest),
    last_error_code = case when account_processor_receipts.status='completed' then null else excluded.last_error_code end,
    completed_at = coalesce(account_processor_receipts.completed_at,excluded.completed_at),
    updated_at = now()
  returning * into v_receipt;
  return v_receipt;
end $$;

create or replace function public.register_account_export_artifact(
  p_request_id uuid,
  p_object_key text,
  p_content_sha256 text,
  p_byte_size bigint,
  p_key_version text,
  p_wrapped_data_key text,
  p_manifest jsonb,
  p_expires_at timestamptz
) returns public.account_export_artifacts
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_artifact public.account_export_artifacts;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if not exists(select 1 from public.account_lifecycle_requests where id=p_request_id) then
    raise exception 'lifecycle request not found' using errcode='P0002';
  end if;
  insert into public.account_export_artifacts(
    request_id,object_key,content_sha256,byte_size,key_version,wrapped_data_key,manifest,expires_at
  ) values (
    p_request_id,p_object_key,lower(p_content_sha256),p_byte_size,p_key_version,
    p_wrapped_data_key,coalesce(p_manifest,'{}'::jsonb),p_expires_at
  )
  on conflict (request_id) where destroyed_at is null do update set
    object_key=excluded.object_key,content_sha256=excluded.content_sha256,
    byte_size=excluded.byte_size,key_version=excluded.key_version,
    wrapped_data_key=excluded.wrapped_data_key,manifest=excluded.manifest,
    expires_at=excluded.expires_at
  returning * into v_artifact;
  return v_artifact;
end $$;

revoke all on function public.record_account_processor_receipt(uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.register_account_export_artifact(uuid,text,text,bigint,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.record_account_processor_receipt(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.register_account_export_artifact(uuid,text,text,bigint,text,text,jsonb,timestamptz) to service_role;

comment on table public.account_retention_policies is 'Versioned operational retention policy; changes require legal and security review.';
comment on table public.account_export_artifacts is 'Metadata only. Export payloads are envelope-encrypted before private object storage.';
comment on table public.account_processor_receipts is 'Idempotency ledger for external and destructive lifecycle operations.';
