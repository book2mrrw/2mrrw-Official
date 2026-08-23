-- ============================================================================
-- E0-D — Function EXECUTE grant hardening
--
-- Fixes a defect found by the E0 live certification (gate 3b).
--
-- ── The defect ──────────────────────────────────────────────────────────────
-- E0-B and E0-C protected their functions with:
--
--     revoke all on function public.f(...) from anon;
--     revoke all on function public.f(...) from authenticated;
--
-- That is insufficient. PostgreSQL grants EXECUTE on every newly created
-- function to PUBLIC by default. `authenticated` and `anon` are members of
-- PUBLIC, so they retain EXECUTE through that implicit grant no matter how many
-- times the named roles are revoked. Revoking from a role does not remove a
-- privilege that role holds via PUBLIC.
--
--     revoke ... from authenticated   → removes the (nonexistent) direct grant
--     revoke ... from public          → removes the ACTUAL grant   ← required
--
-- ── Blast radius as shipped ─────────────────────────────────────────────────
-- All four E0 functions were callable by any authenticated client:
--     bootstrap_admin_by_email(text)
--     recover_admin_principal(text)
--     attest_ownership_parity()
--     set_ownership_authority_state(text)
--
-- All four are SECURITY INVOKER, so a caller still hit RLS and table grants on
-- the way through, and none of them could actually confer privilege:
--   - the two admin functions read auth.users and insert into admin_principals,
--     both denied to client roles → they error out;
--   - the two ownership functions update ownership_authority_state, which has
--     RLS on with zero policies → the UPDATE silently matches zero rows.
--
-- So the exposure was inert rather than exploitable. It is still wrong: an
-- exposed function surface is a latent hole one policy change away from being
-- live, and set_ownership_authority_state returned a success string while
-- having changed nothing, which is a misleading contract.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
-- Revoke from PUBLIC, then grant EXECUTE explicitly to service_role only.
-- Applied to every E0 function, not just the one the certification happened to
-- test — the coverage gap is fixed in the certification too.
--
-- SAFE TO RE-RUN.
-- ============================================================================

begin;

do $$
declare
  fn text;
  fns text[] := array[
    'public.bootstrap_admin_by_email(text)',
    'public.recover_admin_principal(text)',
    'public.attest_ownership_parity()',
    'public.set_ownership_authority_state(text)',
    'public.profiles_guard_privileged_columns()'
  ];
begin
  foreach fn in array fns loop
    -- to_regprocedure returns NULL rather than raising when the signature is
    -- absent, so a partially-applied migration set does not break this one.
    if to_regprocedure(fn) is not null then
      -- The load-bearing statement: strips the implicit default grant.
      execute format('revoke all on function %s from public', fn);
      execute format('revoke all on function %s from anon', fn);
      execute format('revoke all on function %s from authenticated', fn);
      -- Server code uses the service key; give it back explicitly.
      execute format('grant execute on function %s to service_role', fn);
      raise notice 'hardened %', fn;
    else
      raise notice 'skipped (absent) %', fn;
    end if;
  end loop;
end $$;

-- Future functions created in this schema default to PUBLIC EXECUTE as well.
-- This does not retroactively affect anything above; it changes the default for
-- functions created LATER by the same role, so the footgun does not recur.
alter default privileges in schema public revoke execute on functions from public;

commit;

-- ============================================================================
-- VERIFY — every row must read PASS.
-- ============================================================================

select
  f.signature,
  case
    when to_regprocedure(f.signature) is null then 'ABSENT'
    when has_function_privilege('authenticated', f.signature, 'EXECUTE') then 'FAIL'
    when has_function_privilege('anon', f.signature, 'EXECUTE')          then 'FAIL'
    else 'PASS'
  end as client_execute_blocked,
  case
    when to_regprocedure(f.signature) is null then 'ABSENT'
    when has_function_privilege('service_role', f.signature, 'EXECUTE') then 'PASS'
    else 'FAIL'
  end as service_role_can_execute
from (values
  ('public.bootstrap_admin_by_email(text)'),
  ('public.recover_admin_principal(text)'),
  ('public.attest_ownership_parity()'),
  ('public.set_ownership_authority_state(text)'),
  ('public.profiles_guard_privileged_columns()')
) as f(signature);
