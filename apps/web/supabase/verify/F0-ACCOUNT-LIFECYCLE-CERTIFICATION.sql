-- READ ONLY. Run after migrations 40-48. Every row must return pass=true.
with required_tables(name) as (values
  ('account_lifecycle_requests'),('account_lifecycle_steps'),('account_lifecycle_events'),
  ('account_lifecycle_holds'),('account_retention_policies'),('account_export_artifacts'),
  ('account_processor_receipts'),('account_owned_storage_objects'),('account_lifecycle_seals')
)
select 'required_tables' test, count(*)=9 pass, count(*) detail
from required_tables r join information_schema.tables t on t.table_schema='public' and t.table_name=r.name
union all
select 'rls_enabled',count(*)=9,count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('account_lifecycle_requests','account_lifecycle_steps','account_lifecycle_events','account_lifecycle_holds','account_retention_policies','account_export_artifacts','account_processor_receipts','account_owned_storage_objects','account_lifecycle_seals') and c.relrowsecurity
union all
select 'active_requests_unique',count(*)=1,count(*) from pg_indexes where schemaname='public' and indexname='account_lifecycle_one_active_kind'
union all
select 'immutable_seal_trigger',count(*)=1,count(*) from information_schema.triggers where event_object_schema='public' and event_object_table='account_lifecycle_seals' and trigger_name='account_lifecycle_seals_immutable'
union all
select 'service_worker_functions',count(*)=12,count(*) from information_schema.routines where routine_schema='public' and routine_name in (
  'claim_account_lifecycle_step','finish_account_lifecycle_step','retry_account_lifecycle_step','defer_account_lifecycle_step',
  'record_account_processor_receipt','register_account_export_artifact','mark_account_export_delivered','destroy_account_export_artifact',
  'erase_account_ephemeral_data','anonymize_account_retained_records','revoke_account_capabilities','seal_account_lifecycle');

-- Operational health snapshot (informational; must not mutate):
select status,count(*) from public.account_lifecycle_requests group by status order by status;
select step_key,status,count(*) from public.account_lifecycle_steps group by step_key,status order by step_key,status;
select count(*) as expired_active_leases from public.account_lifecycle_steps
 where status='processing' and lease_expires_at <= now();
select count(*) as overdue_live_exports from public.account_export_artifacts
 where destroyed_at is null and expires_at <= now();
