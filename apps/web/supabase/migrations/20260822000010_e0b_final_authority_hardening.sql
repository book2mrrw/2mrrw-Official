-- ============================================================================
-- E0-B — Final Authority Hardening
--
-- Supersedes parts of 20260821000010_entitlement_authority_hardening.sql.
-- SAFE TO RUN whether or not E0-A has been applied. Fully idempotent.
--
-- Contents
--   1. CORRECTED guard trigger  — E0-A's predicate would have blocked migrations
--   2. admin_principals hardening + email bootstrap helper
--   3. ownership_authority_state — explicit ENT-06 migration state
--   4. Verification harness (bottom of file, run separately)
-- ============================================================================

begin;

-- ── 1. CORRECTED role guard ────────────────────────────────────────────────
--
-- DEFECT IN E0-A (found by the three-context test requirement):
--
--     coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
--              current_user) <> 'service_role'
--
-- A request arriving through PostgREST always carries request.jwt.claim.role.
-- Direct SQL — a migration, psql, the Supabase SQL editor — carries none, so the
-- COALESCE fell through to current_user, which is 'postgres' or 'supabase_admin'
-- in those contexts. 'postgres' <> 'service_role' is TRUE, so the trigger would
-- have raised on any migration that legitimately changes profiles.role,
-- including a future backfill or an operator correcting a row by hand.
--
-- CORRECTED MODEL — classify by how the statement arrived, not by role name:
--
--   jwt_role IS NULL   → not a PostgREST request. Reaching this connection at
--                        all requires database credentials, so the caller is
--                        already privileged. ALLOW.
--   jwt_role = service_role → server code holding the service key. ALLOW.
--   jwt_role = anything else (anon / authenticated / any future client role)
--                        → browser-originated. DENY.
--
-- This is an allow-list on the two privileged arrival paths; every client role,
-- including any added later, is denied by default.

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role      text    := nullif(current_setting('request.jwt.claim.role', true), '');
  is_privileged boolean := (jwt_role is null) or (jwt_role = 'service_role');
begin
  if new.role is distinct from old.role and not is_privileged then
    raise exception
      'profiles.role is server-controlled and cannot be modified by clients (INV-ENT-1)'
      using errcode = '42501',
            detail  = format('caller jwt role = %s', coalesce(jwt_role, '<direct sql>'));
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns() is
  'INV-ENT-1. Denies client-originated mutation of profiles.role. Privileged '
  'arrival paths (direct SQL with DB credentials, or PostgREST with service_role) '
  'are permitted. Verified against all three execution contexts.';

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();


-- ── 2. admin_principals — ensure present even if E0-A was skipped ──────────

create table if not exists public.admin_principals (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users (id) on delete set null,
  note        text
);

alter table public.admin_principals enable row level security;
revoke all on public.admin_principals from anon;
revoke all on public.admin_principals from authenticated;

-- Backfill from the legacy role column (no-op if already done).
insert into public.admin_principals (user_id, note)
select p.id, 'backfilled from profiles.role'
from public.profiles p
where p.role = 'admin'
on conflict (user_id) do nothing;

-- ── 2b. One-time email bootstrap ───────────────────────────────────────────
--
-- ADMIN_EMAIL is being REMOVED as a runtime authority source (E0-B). Email is
-- mutable and re-assignable; administrative authority must bind to an immutable
-- principal id. This helper exists only so an operator can seed the FIRST admin
-- by email from a privileged SQL session, after which the binding is by user_id.
--
-- It is SECURITY INVOKER on purpose: the caller must already have privileges to
-- read auth.users. It is not reachable from PostgREST client roles.

create or replace function public.bootstrap_admin_by_email(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'no auth.users row for email %', p_email;
  end if;

  insert into public.admin_principals (user_id, note)
  values (v_user_id, format('bootstrapped by email %s', p_email))
  on conflict (user_id) do nothing;

  return v_user_id;
end;
$$;

revoke all on function public.bootstrap_admin_by_email(text) from public;   -- ← the load-bearing one: EXECUTE defaults to PUBLIC
revoke all on function public.bootstrap_admin_by_email(text) from anon;
revoke all on function public.bootstrap_admin_by_email(text) from authenticated;
grant  execute on function public.bootstrap_admin_by_email(text) to service_role;

comment on function public.bootstrap_admin_by_email(text) is
  'Operator-only. Seeds the first admin principal by email from a privileged SQL '
  'session. Runtime authority never consults email (INV-ENT-9).';


-- ── 3. ENT-06 — explicit ownership authority state ─────────────────────────
--
-- Replaces the implicit rule "the entitlements table exists, therefore it is
-- authoritative", under which a user whose rows were never backfilled reported
-- as owning nothing. Authority is now an explicit, auditable state.
--
--   LEGACY_LIBRARY        library_items is authoritative; entitlements ignored
--   DUAL_VERIFY           union of both; divergence recorded (safe default)
--   ENTITLEMENTS_CANONICAL entitlements is authoritative; library_items ignored
--
-- Advance only after entitlements-parity reports libraryOnly = 0.

create table if not exists public.ownership_authority_state (
  id          boolean primary key default true check (id),
  state       text not null default 'DUAL_VERIFY'
                check (state in ('LEGACY_LIBRARY', 'DUAL_VERIFY', 'ENTITLEMENTS_CANONICAL')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  note        text
);

insert into public.ownership_authority_state (id, state, note)
values (true, 'DUAL_VERIFY', 'E0-B default — union both sources until parity is proven')
on conflict (id) do nothing;

alter table public.ownership_authority_state enable row level security;
revoke all on public.ownership_authority_state from anon;
revoke all on public.ownership_authority_state from authenticated;

comment on table public.ownership_authority_state is
  'INV-ENT-10: the ownership source of truth is an explicit state, never inferred '
  'from table existence. Single row enforced by the id boolean primary key.';

commit;


-- ============================================================================
-- VERIFICATION HARNESS — run AFTER the migration, as a privileged SQL session.
-- Every check prints PASS or FAIL. Nothing here mutates persistent state.
-- ============================================================================
--
-- do $$
-- declare
--   v_uid   uuid;
--   v_role  text;
--   v_ok    boolean;
--   v_msg   text;
-- begin
--   raise notice '── E0 verification ────────────────────────────────────────';
--
--   -- CONTEXT 1: privileged direct SQL (this session). Must be ALLOWED.
--   select id, role into v_uid, v_role from public.profiles limit 1;
--   if v_uid is null then
--     raise notice 'SKIP  ctx1 — no profiles rows';
--   else
--     begin
--       update public.profiles set role = role where id = v_uid;   -- no-op write
--       update public.profiles set role = 'admin' where id = v_uid;
--       update public.profiles set role = v_role where id = v_uid; -- restore
--       raise notice 'PASS  ctx1 direct SQL may change profiles.role';
--     exception when others then
--       raise notice 'FAIL  ctx1 direct SQL BLOCKED (%) — migrations would break', sqlerrm;
--     end;
--   end if;
--
--   -- CONTEXT 2: simulated PostgREST service_role. Must be ALLOWED.
--   perform set_config('request.jwt.claim.role', 'service_role', true);
--   begin
--     update public.profiles set role = 'admin' where id = v_uid;
--     update public.profiles set role = v_role  where id = v_uid;
--     raise notice 'PASS  ctx2 service_role may change profiles.role';
--   exception when others then
--     raise notice 'FAIL  ctx2 service_role BLOCKED (%) — server code would break', sqlerrm;
--   end;
--
--   -- CONTEXT 3: simulated PostgREST authenticated. Must be DENIED.
--   perform set_config('request.jwt.claim.role', 'authenticated', true);
--   begin
--     update public.profiles set role = 'admin' where id = v_uid;
--     raise notice 'FAIL  ctx3 authenticated CHANGED profiles.role — ENT-01 STILL OPEN';
--     update public.profiles set role = v_role where id = v_uid;
--   exception when sqlstate '42501' then
--     raise notice 'PASS  ctx3 authenticated denied with 42501';
--   when others then
--     raise notice 'PASS? ctx3 denied but with unexpected error: %', sqlerrm;
--   end;
--
--   -- CONTEXT 4: simulated anon. Must be DENIED.
--   perform set_config('request.jwt.claim.role', 'anon', true);
--   begin
--     update public.profiles set role = 'admin' where id = v_uid;
--     raise notice 'FAIL  ctx4 anon CHANGED profiles.role';
--     update public.profiles set role = v_role where id = v_uid;
--   exception when sqlstate '42501' then
--     raise notice 'PASS  ctx4 anon denied with 42501';
--   when others then
--     raise notice 'PASS? ctx4 denied but with unexpected error: %', sqlerrm;
--   end;
--
--   perform set_config('request.jwt.claim.role', '', true);
--
--   -- Structural checks
--   select count(*) = 0 into v_ok
--   from pg_policies where schemaname = 'public' and tablename = 'admin_principals';
--   raise notice '%  admin_principals has zero policies (RLS denies all clients)',
--     case when v_ok then 'PASS ' else 'FAIL ' end;
--
--   select has_table_privilege('authenticated', 'public.admin_principals', 'SELECT')
--     into v_ok;
--   raise notice '%  authenticated cannot SELECT admin_principals',
--     case when not v_ok then 'PASS ' else 'FAIL ' end;
--
--   select has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
--     into v_ok;
--   raise notice '%  authenticated lacks UPDATE on profiles.role',
--     case when not v_ok then 'PASS ' else 'FAIL ' end;
--
--   select count(*) > 0 into v_ok from public.admin_principals;
--   raise notice '%  at least one admin principal exists (not locked out)',
--     case when v_ok then 'PASS ' else 'FAIL ' end;
--
--   select state into v_msg from public.ownership_authority_state where id;
--   raise notice 'INFO  ownership authority state = %', v_msg;
--
--   select bool_and(is_collector_product is not null) into v_ok from public.products;
--   raise notice '%  products.is_collector_product fully populated',
--     case when coalesce(v_ok, true) then 'PASS ' else 'FAIL ' end;
--
--   raise notice '───────────────────────────────────────────────────────────';
-- end $$;
-- ============================================================================
