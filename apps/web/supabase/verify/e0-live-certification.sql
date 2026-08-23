-- ============================================================================
-- E0 LIVE SECURITY CERTIFICATION
--
-- ⚠ THIS FILE IS SQL. Paste the whole thing into the Supabase SQL editor.
--   The HTTP check (e0-http-check.mjs) is a TERMINAL command — not SQL.
--
-- Run e0-step0-preflight.sql FIRST and make sure every migration reads PRESENT.
--
-- ── Why this is a DO block and not a function ───────────────────────────────
--   An earlier revision used CREATE FUNCTION. PostgreSQL parse-checks function
--   bodies at CREATE time (check_function_bodies = on), resolving every table
--   and column reference — including ones inside branches guarded by
--   to_regclass(). So the CREATE was rejected outright whenever a migration had
--   not been applied yet, and only the trailing SELECT ran:
--       ERROR: function public.e0_certify() does not exist
--   A DO block prepares statements lazily, so guarded branches that never
--   execute are never resolved. Results are written to a table so they appear
--   in the results grid instead of the hidden Notices panel.
--
-- ── Scope ───────────────────────────────────────────────────────────────────
--   This runs as a PRIVILEGED role, which bypasses RLS and column privileges.
--   It proves the guard TRIGGER and inspects the catalog. It does NOT prove a
--   real browser session is blocked — that is what e0-http-check.mjs is for.
--   Both must pass. This script reports that as its own row.
-- ============================================================================

create table if not exists public.e0_certification_results (
  seq     serial primary key,
  run_at  timestamptz not null default now(),
  gate    text,
  status  text,
  detail  text
);

truncate public.e0_certification_results restart identity;

do $cert$
declare
  v_uid   uuid;
  v_role  text;
  v_ok    boolean;
  v_n     integer;
  v_state text;
  v_pass  integer := 0;
  v_fail  integer := 0;
  v_has_created_at boolean;
begin
  -- helper is inlined as an INSERT everywhere; plpgsql has no local procedures.

  -- ── probe subject ────────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='created_at'
  ) into v_has_created_at;

  if v_has_created_at then
    select p.id, p.role into v_uid, v_role
    from public.profiles p order by p.created_at limit 1;
  else
    select p.id, p.role into v_uid, v_role from public.profiles p limit 1;
  end if;

  if v_uid is null then
    insert into public.e0_certification_results (gate, status, detail)
    values ('0. probe subject', 'ABORT', 'no rows in public.profiles — role probes cannot run');
    return;
  end if;

  insert into public.e0_certification_results (gate, status, detail)
  values ('0. probe subject', 'INFO',
          format('user %s, current role = %s', v_uid, coalesce(v_role, '<null>')));

  -- ── 1. guard trigger: four execution contexts ────────────────────────────

  if not exists (
    select 1 from pg_trigger
    where tgname='profiles_guard_privileged_columns' and not tgisinternal
  ) then
    insert into public.e0_certification_results (gate, status, detail)
    values ('1. guard trigger', 'FAIL',
            'trigger not installed — apply 20260821000010 and 20260822000010');
    v_fail := v_fail + 1;
  else
    perform set_config('request.jwt.claim.role', '', true);
    begin
      update public.profiles set role = 'admin' where id = v_uid;
      update public.profiles set role = v_role   where id = v_uid;
      insert into public.e0_certification_results (gate, status, detail)
      values ('1a. ctx direct SQL', 'PASS', 'privileged SQL may change profiles.role (migrations work)');
      v_pass := v_pass + 1;
    exception when others then
      insert into public.e0_certification_results (gate, status, detail)
      values ('1a. ctx direct SQL', 'FAIL', format('BLOCKED (%s) — migrations cannot change role', sqlerrm));
      v_fail := v_fail + 1;
    end;

    perform set_config('request.jwt.claim.role', 'service_role', true);
    begin
      update public.profiles set role = 'admin' where id = v_uid;
      update public.profiles set role = v_role   where id = v_uid;
      insert into public.e0_certification_results (gate, status, detail)
      values ('1b. ctx service_role', 'PASS', 'server code may change profiles.role');
      v_pass := v_pass + 1;
    exception when others then
      insert into public.e0_certification_results (gate, status, detail)
      values ('1b. ctx service_role', 'FAIL', format('BLOCKED (%s) — server writes break', sqlerrm));
      v_fail := v_fail + 1;
    end;

    perform set_config('request.jwt.claim.role', 'authenticated', true);
    begin
      update public.profiles set role = 'admin' where id = v_uid;
      update public.profiles set role = v_role where id = v_uid;
      insert into public.e0_certification_results (gate, status, detail)
      values ('1c. ctx authenticated', 'FAIL', 'authenticated CHANGED profiles.role — ENT-01 STILL OPEN');
      v_fail := v_fail + 1;
    exception when sqlstate '42501' then
      insert into public.e0_certification_results (gate, status, detail)
      values ('1c. ctx authenticated', 'PASS', 'denied with 42501');
      v_pass := v_pass + 1;
    when others then
      insert into public.e0_certification_results (gate, status, detail)
      values ('1c. ctx authenticated', 'PASS', format('denied (%s)', sqlerrm));
      v_pass := v_pass + 1;
    end;

    perform set_config('request.jwt.claim.role', 'anon', true);
    begin
      update public.profiles set role = 'admin' where id = v_uid;
      update public.profiles set role = v_role where id = v_uid;
      insert into public.e0_certification_results (gate, status, detail)
      values ('1d. ctx anon', 'FAIL', 'anon CHANGED profiles.role');
      v_fail := v_fail + 1;
    exception when sqlstate '42501' then
      insert into public.e0_certification_results (gate, status, detail)
      values ('1d. ctx anon', 'PASS', 'denied with 42501');
      v_pass := v_pass + 1;
    when others then
      insert into public.e0_certification_results (gate, status, detail)
      values ('1d. ctx anon', 'PASS', format('denied (%s)', sqlerrm));
      v_pass := v_pass + 1;
    end;

    perform set_config('request.jwt.claim.role', '', true);
    update public.profiles set role = v_role where id = v_uid;   -- restore

    insert into public.e0_certification_results (gate, status, detail)
    values ('1e. probe cleanup', 'INFO',
            format('profiles.role restored to %s', coalesce(v_role, '<null>')));
  end if;

  -- ── 2. privilege surface ─────────────────────────────────────────────────

  if to_regclass('public.admin_principals') is null then
    insert into public.e0_certification_results (gate, status, detail)
    values ('2. admin_principals', 'FAIL', 'table missing — apply 20260821000010 / 20260822000010');
    v_fail := v_fail + 1;
  else
    select count(*) = 0 into v_ok
      from pg_policies where schemaname='public' and tablename='admin_principals';
    insert into public.e0_certification_results (gate, status, detail)
    values ('2a. admin_principals policies',
            case when v_ok then 'PASS' else 'FAIL' end,
            'zero RLS policies → denies all client roles');
    if v_ok then v_pass := v_pass+1; else v_fail := v_fail+1; end if;

    select has_table_privilege('authenticated','public.admin_principals','SELECT') into v_ok;
    insert into public.e0_certification_results (gate, status, detail)
    values ('2b. admin_principals SELECT',
            case when not v_ok then 'PASS' else 'FAIL' end,
            'authenticated must not be able to read it');
    if not v_ok then v_pass := v_pass+1; else v_fail := v_fail+1; end if;

    execute 'select count(*) from public.admin_principals' into v_n;
    insert into public.e0_certification_results (gate, status, detail)
    values ('2c. admin principals exist',
            case when v_n > 0 then 'PASS' else 'FAIL' end,
            case when v_n > 0 then format('%s principal(s) — not locked out', v_n)
                 else 'NONE — run: select * from public.recover_admin_principal(''you@example.com'');' end);
    if v_n > 0 then v_pass := v_pass+1; else v_fail := v_fail+1; end if;
  end if;

  select has_column_privilege('authenticated','public.profiles','role','UPDATE') into v_ok;
  insert into public.e0_certification_results (gate, status, detail)
  values ('2d. profiles.role UPDATE grant',
          case when not v_ok then 'PASS' else 'FAIL' end,
          'authenticated must lack UPDATE on the role column');
  if not v_ok then v_pass := v_pass+1; else v_fail := v_fail+1; end if;

  select has_column_privilege('authenticated','public.profiles','full_name','UPDATE') into v_ok;
  insert into public.e0_certification_results (gate, status, detail)
  values ('2e. profiles.full_name UPDATE grant',
          case when v_ok then 'PASS' else 'FAIL' end,
          'ordinary profile edits must still work (not over-locked)');
  if v_ok then v_pass := v_pass+1; else v_fail := v_fail+1; end if;

  -- ── 3. ownership authority ───────────────────────────────────────────────

  if to_regclass('public.ownership_authority_state') is null then
    insert into public.e0_certification_results (gate, status, detail)
    values ('3. ownership state', 'FAIL', 'table missing — apply 20260822000010 / 20260822000020');
    v_fail := v_fail + 1;
  else
    execute $q$
      select state, coalesce(parity_library_only_count, -1)
      from public.ownership_authority_state where id
    $q$ into v_state, v_n;

    if v_state = 'ENTITLEMENTS_CANONICAL' and v_n <> 0 then
      insert into public.e0_certification_results (gate, status, detail)
      values ('3a. ownership state', 'FAIL',
              format('CANONICAL set but parity = %s — the app will refuse it', v_n));
      v_fail := v_fail + 1;
    else
      insert into public.e0_certification_results (gate, status, detail)
      values ('3a. ownership state', 'PASS',
              format('state=%s, parity library-only=%s', v_state,
                     case when v_n < 0 then 'not attested' else v_n::text end));
      v_pass := v_pass + 1;
    end if;

  end if;

  -- ── 3b. EVERY security-sensitive function, not just one ──────────────────
  --
  -- The original gate tested only set_ownership_authority_state and therefore
  -- reported one FAIL when all four functions had the same defect: EXECUTE is
  -- granted to PUBLIC by default, so `revoke ... from authenticated` leaves the
  -- privilege in place. Checking a representative sample hid the real scope.
  declare
    fn  text;
    fns text[] := array[
      'public.bootstrap_admin_by_email(text)',
      'public.recover_admin_principal(text)',
      'public.attest_ownership_parity()',
      'public.set_ownership_authority_state(text)',
      'public.profiles_guard_privileged_columns()'
    ];
    v_exposed text[] := array[]::text[];
    v_checked integer := 0;
  begin
    foreach fn in array fns loop
      if to_regprocedure(fn) is not null then
        v_checked := v_checked + 1;
        if has_function_privilege('authenticated', fn, 'EXECUTE')
           or has_function_privilege('anon', fn, 'EXECUTE') then
          v_exposed := v_exposed || fn;
        end if;
      end if;
    end loop;

    insert into public.e0_certification_results (gate, status, detail)
    values ('3b. function EXECUTE grants',
            case when array_length(v_exposed, 1) is null then 'PASS' else 'FAIL' end,
            case when array_length(v_exposed, 1) is null
                 then format('%s function(s) checked, none client-executable', v_checked)
                 else format('client-executable: %s  — revoke from PUBLIC, not just the role',
                             array_to_string(v_exposed, ', ')) end);
    if array_length(v_exposed, 1) is null then v_pass := v_pass+1; else v_fail := v_fail+1; end if;
  end;

  -- ── 4. collector authority ───────────────────────────────────────────────

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='is_collector_product'
  ) then
    execute 'select bool_and(is_collector_product is not null) from public.products' into v_ok;
    insert into public.e0_certification_results (gate, status, detail)
    values ('4a. is_collector_product populated',
            case when coalesce(v_ok, true) then 'PASS' else 'FAIL' end,
            'every product row must carry an explicit boolean');
    if coalesce(v_ok, true) then v_pass := v_pass+1; else v_fail := v_fail+1; end if;
  else
    insert into public.e0_certification_results (gate, status, detail)
    values ('4a. is_collector_product', 'FAIL', 'column missing — apply 20260821000010');
    v_fail := v_fail + 1;
  end if;

  -- ── 5. no client write policy on any privilege table ─────────────────────

  select count(*) into v_n
  from pg_policies
  where schemaname='public'
    and tablename in ('user_entitlements','memberships','library_items',
                      'collector_ownerships','collector_access','vault_entitlements',
                      'entitlements','purchases','admin_principals',
                      'ownership_authority_state')
    and cmd in ('INSERT','UPDATE','DELETE','ALL');
  insert into public.e0_certification_results (gate, status, detail)
  values ('5a. privilege-table write policies',
          case when v_n = 0 then 'PASS' else 'FAIL' end,
          format('%s client write policies found (expect 0)', v_n));
  if v_n = 0 then v_pass := v_pass+1; else v_fail := v_fail+1; end if;

  -- ── 6. scope reminder ────────────────────────────────────────────────────

  insert into public.e0_certification_results (gate, status, detail)
  values ('6a. end-to-end HTTP proof', 'REQUIRED',
          'This script runs privileged and bypasses RLS + column grants. '
       || 'Run e0-http-check.mjs IN A TERMINAL to prove a real browser session is blocked.');

  -- ── verdict ──────────────────────────────────────────────────────────────

  insert into public.e0_certification_results (gate, status, detail)
  values ('== VERDICT ==',
          case when v_fail = 0 then 'PASS' else 'FAIL' end,
          format('%s passed, %s failed. %s', v_pass, v_fail,
            case when v_fail = 0
              then 'SQL-layer PASS — now run the HTTP check in a terminal.'
              else 'DO NOT PROCEED to Slice 1D.' end));
end
$cert$;

-- ── Read the verdict ────────────────────────────────────────────────────────
select seq, gate, status, detail
from public.e0_certification_results
order by seq;
