-- ============================================================================
-- E0-C — Atomic Authority Closure
--
-- Adds the parity attestation that gates ENTITLEMENTS_CANONICAL, and the
-- admin-principal recovery procedure. Fully idempotent; safe to re-run.
--
-- Apply order:  E0-A (20260821000010) → E0-B (20260822000010) → E0-C (this file)
-- Each is independently idempotent, so a skipped predecessor is not fatal.
-- ============================================================================

begin;

-- ── 1. Parity attestation for the ownership cutover ────────────────────────
--
-- INV-ENT-14: ENTITLEMENTS_CANONICAL discards library_items entirely. Setting
-- that state without proof of parity would silently strip ownership from every
-- user whose rows were never backfilled — re-entering the ENT-06 failure through
-- configuration instead of inference.
--
-- The application refuses to honour CANONICAL unless parity_verified_at is set
-- AND parity_library_only_count = 0. Both are written by the attestation
-- function below, which recomputes the number from live data rather than
-- trusting an operator to type zero.

create table if not exists public.ownership_authority_state (
  id          boolean primary key default true check (id),
  state       text not null default 'DUAL_VERIFY'
                check (state in ('LEGACY_LIBRARY', 'DUAL_VERIFY', 'ENTITLEMENTS_CANONICAL')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  note        text
);

alter table public.ownership_authority_state
  add column if not exists parity_verified_at        timestamptz,
  add column if not exists parity_library_only_count integer;

insert into public.ownership_authority_state (id, state, note)
values (true, 'DUAL_VERIFY', 'E0-C default — union both sources until parity is attested')
on conflict (id) do nothing;

alter table public.ownership_authority_state enable row level security;
revoke all on public.ownership_authority_state from anon;
revoke all on public.ownership_authority_state from authenticated;


-- ── 2. Parity attestation — recomputed, never asserted ─────────────────────
--
-- Counts (user_id, product_id) pairs present in library_items but absent from
-- active entitlements. Writes the result and the timestamp. Returns the count so
-- the operator sees it immediately.

create or replace function public.attest_ownership_parity()
returns integer
language plpgsql
as $$
declare
  v_library_only integer;
begin
  if to_regclass('public.entitlements') is null then
    raise exception 'entitlements table does not exist — parity cannot be attested';
  end if;

  select count(*)
    into v_library_only
  from public.library_items li
  where li.product_id is not null
    and not exists (
      select 1
      from public.entitlements e
      where e.user_id       = li.user_id
        and e.resource_type = 'product'
        and e.resource_id   = li.product_id
        and e.status        = 'active'
    );

  update public.ownership_authority_state
     set parity_library_only_count = v_library_only,
         parity_verified_at        = now(),
         updated_at                = now()
   where id;

  return v_library_only;
end;
$$;

revoke all on function public.attest_ownership_parity() from public;   -- ← the load-bearing one: EXECUTE defaults to PUBLIC
revoke all on function public.attest_ownership_parity() from anon;
revoke all on function public.attest_ownership_parity() from authenticated;
grant  execute on function public.attest_ownership_parity() to service_role;

comment on function public.attest_ownership_parity() is
  'INV-ENT-14. Recomputes library-only ownership rows and records the attestation. '
  'ENTITLEMENTS_CANONICAL is refused by the application until this returns 0.';


-- ── 3. Guarded cutover ─────────────────────────────────────────────────────
-- Refuses to advance to CANONICAL unless parity was attested at zero, and
-- re-attests as part of the call so a stale attestation cannot be relied on.

create or replace function public.set_ownership_authority_state(p_state text)
returns text
language plpgsql
as $$
declare
  v_library_only integer;
begin
  if p_state not in ('LEGACY_LIBRARY', 'DUAL_VERIFY', 'ENTITLEMENTS_CANONICAL') then
    raise exception 'invalid ownership authority state: %', p_state;
  end if;

  if p_state = 'ENTITLEMENTS_CANONICAL' then
    v_library_only := public.attest_ownership_parity();
    if v_library_only <> 0 then
      raise exception
        'cannot advance to ENTITLEMENTS_CANONICAL: % library_items rows have no active entitlement. Backfill first.',
        v_library_only
        using errcode = '23514';
    end if;
  end if;

  update public.ownership_authority_state
     set state = p_state, updated_at = now()
   where id;

  return p_state;
end;
$$;

revoke all on function public.set_ownership_authority_state(text) from public;   -- ← the load-bearing one: EXECUTE defaults to PUBLIC
revoke all on function public.set_ownership_authority_state(text) from anon;
revoke all on function public.set_ownership_authority_state(text) from authenticated;
grant  execute on function public.set_ownership_authority_state(text) to service_role;


-- ── 4. Admin recovery — break-glass that cannot lock administration out ────
--
-- If admin_principals is ever emptied by accident, there is no in-app path back:
-- every /api/admin/* route requires an existing admin. This function is the
-- documented recovery path and is reachable only from a privileged SQL session.

create or replace function public.recover_admin_principal(p_email text)
returns TABLE (user_id uuid, email text, action text)
language plpgsql
as $$
declare
  v_user_id uuid;
  v_existed boolean;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'no auth.users row for email % — cannot recover', p_email;
  end if;

  select exists (select 1 from public.admin_principals ap where ap.user_id = v_user_id)
    into v_existed;

  insert into public.admin_principals (user_id, note)
  values (v_user_id, format('break-glass recovery at %s', now()))
  on conflict (user_id) do nothing;

  return query
    select v_user_id, p_email,
           case when v_existed then 'already_admin' else 'granted' end;
end;
$$;

revoke all on function public.recover_admin_principal(text) from public;   -- ← the load-bearing one: EXECUTE defaults to PUBLIC
revoke all on function public.recover_admin_principal(text) from anon;
revoke all on function public.recover_admin_principal(text) from authenticated;
grant  execute on function public.recover_admin_principal(text) to service_role;

comment on function public.recover_admin_principal(text) is
  'Break-glass admin recovery. Privileged SQL only. Email is used solely to LOOK UP '
  'an immutable user id here — it never grants authority at runtime (INV-ENT-9).';

commit;

-- ============================================================================
-- E0-C LIVE VERIFICATION — run as a privileged SQL session after applying.
-- ============================================================================
--
-- do $$
-- declare v_n integer; v_state text; v_ok boolean;
-- begin
--   raise notice '── E0-C verification ──────────────────────────────────────';
--
--   -- Parity attestation runs and returns a real number
--   begin
--     v_n := public.attest_ownership_parity();
--     raise notice 'INFO  library-only ownership rows = %', v_n;
--     raise notice '%  parity attestation executes',
--       case when v_n is not null then 'PASS ' else 'FAIL ' end;
--   exception when others then
--     raise notice 'INFO  parity not attestable yet: %', sqlerrm;
--   end;
--
--   -- CANONICAL must be refused while parity is non-zero
--   select coalesce(parity_library_only_count, -1) into v_n
--     from public.ownership_authority_state where id;
--   if v_n > 0 then
--     begin
--       perform public.set_ownership_authority_state('ENTITLEMENTS_CANONICAL');
--       raise notice 'FAIL  CANONICAL accepted with % library-only rows', v_n;
--     exception when others then
--       raise notice 'PASS  CANONICAL refused while parity is non-zero';
--     end;
--   else
--     raise notice 'INFO  parity already zero — CANONICAL would be permitted';
--   end if;
--
--   select state into v_state from public.ownership_authority_state where id;
--   raise notice 'INFO  ownership authority state = %', v_state;
--
--   -- Recovery path is reachable and idempotent
--   raise notice 'INFO  recovery: select * from public.recover_admin_principal(''you@example.com'');';
--
--   -- Client roles cannot reach any of it
--   select has_function_privilege('authenticated',
--            'public.set_ownership_authority_state(text)', 'EXECUTE') into v_ok;
--   raise notice '%  authenticated cannot execute set_ownership_authority_state',
--     case when not v_ok then 'PASS ' else 'FAIL ' end;
--
--   select has_function_privilege('authenticated',
--            'public.recover_admin_principal(text)', 'EXECUTE') into v_ok;
--   raise notice '%  authenticated cannot execute recover_admin_principal',
--     case when not v_ok then 'PASS ' else 'FAIL ' end;
--
--   select has_table_privilege('authenticated',
--            'public.ownership_authority_state', 'SELECT') into v_ok;
--   raise notice '%  authenticated cannot read ownership_authority_state',
--     case when not v_ok then 'PASS ' else 'FAIL ' end;
--
--   raise notice '───────────────────────────────────────────────────────────';
-- end $$;
-- ============================================================================
