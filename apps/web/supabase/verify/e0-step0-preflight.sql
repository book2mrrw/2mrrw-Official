-- ============================================================================
-- E0 PREFLIGHT — which migrations are actually applied?
--
-- Run this FIRST. It is a single read-only SELECT: no functions, no DO blocks,
-- no writes. It returns rows, so the Supabase editor will show it.
--
-- Every row must read PRESENT before the certification script can even be
-- created — PostgreSQL parse-checks function bodies at CREATE time, so a script
-- referencing a table that does not exist yet is rejected before it can run.
-- ============================================================================

select *
from (
  values
    ('E0-A  admin_principals table',
     case when to_regclass('public.admin_principals') is not null
          then 'PRESENT' else 'MISSING — apply 20260821000010' end),

    ('E0-A  products.is_collector_product',
     case when exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='products'
              and column_name='is_collector_product')
          then 'PRESENT' else 'MISSING — apply 20260821000010' end),

    ('E0-A/B guard trigger on profiles',
     case when exists (
            select 1 from pg_trigger
            where tgname = 'profiles_guard_privileged_columns'
              and not tgisinternal)
          then 'PRESENT' else 'MISSING — apply 20260821000010 + 20260822000010' end),

    ('E0-B  bootstrap_admin_by_email()',
     case when to_regprocedure('public.bootstrap_admin_by_email(text)') is not null
          then 'PRESENT' else 'MISSING — apply 20260822000010' end),

    ('E0-B  ownership_authority_state table',
     case when to_regclass('public.ownership_authority_state') is not null
          then 'PRESENT' else 'MISSING — apply 20260822000010' end),

    ('E0-C  parity_verified_at column',
     case when exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='ownership_authority_state'
              and column_name='parity_verified_at')
          then 'PRESENT' else 'MISSING — apply 20260822000020' end),

    ('E0-C  attest_ownership_parity()',
     case when to_regprocedure('public.attest_ownership_parity()') is not null
          then 'PRESENT' else 'MISSING — apply 20260822000020' end),

    ('E0-C  recover_admin_principal()',
     case when to_regprocedure('public.recover_admin_principal(text)') is not null
          then 'PRESENT' else 'MISSING — apply 20260822000020' end),

    ('--- reference ---', '---'),

    ('profiles.created_at exists',
     case when exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='profiles'
              and column_name='created_at')
          then 'yes' else 'NO — certification must not order by it' end),

    ('profiles row count',
     (select count(*)::text from public.profiles)),

    ('admin principals count',
     case when to_regclass('public.admin_principals') is not null
          then (select count(*)::text from public.admin_principals)
          else 'n/a' end),

    ('profiles.role = admin count',
     (select count(*)::text from public.profiles where role = 'admin'))
) as t(check_name, result);
