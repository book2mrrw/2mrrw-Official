-- ============================================================================
-- E1 — Auth Hardening
--
-- 1. Brings login_otp under source control (OPS-01: it existed only in the live
--    database, so it could not be reproduced, reviewed, or covered by the
--    privilege sweep — and it holds authentication material).
-- 2. Adds an ATOMIC OTP consumption function (AUTH-02).
--
-- SAFE TO RE-RUN. Idempotent throughout. The table is created only if absent
-- and existing columns are never altered, so the live table is untouched.
-- ============================================================================

begin;

-- ── 1. login_otp under source control ──────────────────────────────────────

-- Reconciled against the live table on 2026-08-22 (see the shape query at the
-- bottom). This definition now reproduces production exactly, which is the
-- point of OPS-01 — a source definition that does not match reality is not
-- source control. `create table if not exists` never reshapes an existing
-- table, so any divergence here would persist silently forever.
create table if not exists public.login_otp (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  code_hash   text not null,
  attempts    integer not null default 0,
  -- Live carries this default; the application always supplies the value
  -- explicitly, so it is a backstop rather than the source of the TTL.
  expires_at  timestamptz not null default (now() + interval '10 minutes'),
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Additive only — safe against the pre-existing production table.
alter table public.login_otp add column if not exists attempts   integer     not null default 0;
alter table public.login_otp add column if not exists used       boolean     not null default false;
alter table public.login_otp add column if not exists created_at timestamptz not null default now();

create index if not exists idx_login_otp_user_active
  on public.login_otp (user_id, used, expires_at desc);

-- It holds authentication material and is only ever touched by server code
-- through the service role. RLS on with zero policies denies every client role.
alter table public.login_otp enable row level security;
revoke all on public.login_otp from anon;
revoke all on public.login_otp from authenticated;

comment on table public.login_otp is
  'Second-factor codes. Server-only: RLS enabled with no policies. Consumed '
  'exclusively through public.consume_login_otp() so the attempt counter cannot race.';


-- ── 2. Atomic OTP consumption (AUTH-02) ────────────────────────────────────
--
-- THE DEFECT THIS REPLACES
--
--   const newAttempts = otp.attempts + 1;                    -- read
--   await admin.from("login_otp").update({ attempts: newAttempts })...  -- write
--   if (otp.code_hash !== codeHash) { if (newAttempts >= 3) lock }
--
-- Read-modify-write. N parallel guesses all read the same value and all write
-- the same increment, so a three-attempt lockout counts one. login-step2 also
-- had no rate limit, leaving a 10^6 code space reachable by parallel submission.
--
-- This function performs find → increment → compare → mark-used as ONE
-- statement sequence inside a single function invocation, and the increment is
-- an in-place `attempts + 1` evaluated by the database rather than by the
-- caller, so concurrent callers each observe a distinct value.
--
-- Returns one row:
--   result      'ok' | 'invalid' | 'expired' | 'locked'
--   attempts_left  remaining tries (0 when locked or ok)

-- A prior revision took only (user_id, code_hash) and locked the NEWEST live row
-- for that user. Its contract was therefore "consume this user's latest OTP",
-- not "consume this exact challenge". That was correct only because both callers
-- happen to delete prior unused rows before inserting — an invariant held by two
-- separate call sites rather than by the primitive.
--
-- It also carried a TOCTOU: a caller resolving challengeId -> user_id and then
-- invoking this function could have a NEW challenge created for that user in
-- between, at which point the row consumed is not the row presented.
--
-- Consumption is now bound to the immutable challenge id.
--
-- Dropping the OLD 3-argument signature is the load-bearing line: PostgreSQL
-- overloads on parameter list, so creating the 4-argument version without this
-- would leave the unsafe newest-row-for-user variant callable alongside it.
drop function if exists public.consume_login_otp(uuid, text, integer);
-- Also drop the 4-argument form so re-runs replace rather than accumulate.
drop function if exists public.consume_login_otp(uuid, text, integer, uuid);

-- p_challenge_id is REQUIRED — deliberately no DEFAULT.
--
-- An earlier revision made it nullable with an `else newest-live-row-for-user`
-- branch, so two contracts coexisted: "consume THIS challenge" and "consume this
-- user's latest OTP". Keeping the weaker one as a convenience fallback is the
-- same mistake as a fallback secret: once the stronger canonical identity
-- exists, no alternate path to a weaker identity model may remain.
--
-- Omitting the argument is now a hard error (no function matches), not a silent
-- downgrade — which is what makes the removal enforceable rather than advisory.
create or replace function public.consume_login_otp(
  p_user_id      uuid,
  p_code_hash    text,
  p_max_attempts integer,
  p_challenge_id uuid
)
returns table (result text, attempts_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_hash     text;
  v_attempts integer;
begin
  if p_challenge_id is null then
    -- Defensive: a caller passing an explicit NULL is a programming error, not
    -- a request to fall back to weaker matching.
    raise exception 'consume_login_otp: p_challenge_id is required'
      using errcode = '22004';
  end if;

  -- Bind to the exact challenge. The user_id predicate stays so a caller cannot
  -- consume another principal's challenge by presenting its id.
  select o.id, o.code_hash
    into v_id, v_hash
  from public.login_otp o
  where o.id = p_challenge_id
    and o.user_id = p_user_id
    and o.used = false
    and o.expires_at > now()
  for update;

  if v_id is null then
    result := 'expired'; attempts_left := 0; return next; return;
  end if;

  -- In-place increment: the value is computed by the database, not carried in
  -- from a prior read, so parallel callers cannot collide on a stale number.
  update public.login_otp
     set attempts = attempts + 1
   where id = v_id
  returning attempts into v_attempts;

  if v_hash is distinct from p_code_hash then
    if v_attempts >= p_max_attempts then
      update public.login_otp set used = true where id = v_id;
      result := 'locked'; attempts_left := 0; return next; return;
    end if;
    result := 'invalid'; attempts_left := p_max_attempts - v_attempts; return next; return;
  end if;

  -- Correct code: burn it so it cannot be replayed.
  update public.login_otp set used = true where id = v_id;
  result := 'ok'; attempts_left := 0; return next; return;
end;
$$;

-- EXECUTE defaults to PUBLIC — revoke from PUBLIC, not just the named roles.
-- (This is the E0-D lesson; revoking from `authenticated` alone does nothing.)
revoke all on function public.consume_login_otp(uuid, text, integer, uuid) from public;
revoke all on function public.consume_login_otp(uuid, text, integer, uuid) from anon;
revoke all on function public.consume_login_otp(uuid, text, integer, uuid) from authenticated;
grant  execute on function public.consume_login_otp(uuid, text, integer, uuid) to service_role;

commit;

-- ============================================================================
-- VERIFY — every row must read PASS.
-- ============================================================================

select check_name, result from (values
  ('login_otp exists',
   case when to_regclass('public.login_otp') is not null then 'PASS' else 'FAIL' end),
  ('login_otp RLS enabled',
   case when (select relrowsecurity from pg_class where oid = to_regclass('public.login_otp'))
        then 'PASS' else 'FAIL' end),
  ('login_otp has zero policies',
   case when (select count(*) from pg_policies
              where schemaname='public' and tablename='login_otp') = 0
        then 'PASS' else 'FAIL' end),
  ('authenticated cannot read login_otp',
   case when not has_table_privilege('authenticated','public.login_otp','SELECT')
        then 'PASS' else 'FAIL' end),
  ('consume_login_otp exists',
   case when to_regprocedure('public.consume_login_otp(uuid,text,integer,uuid)') is not null
        then 'PASS' else 'FAIL' end),
  ('consume_login_otp not client-executable',
   case when to_regprocedure('public.consume_login_otp(uuid,text,integer,uuid)') is null then 'ABSENT'
        when has_function_privilege('authenticated','public.consume_login_otp(uuid,text,integer,uuid)','EXECUTE')
          or has_function_privilege('anon','public.consume_login_otp(uuid,text,integer,uuid)','EXECUTE')
        then 'FAIL' else 'PASS' end),
  ('service_role can execute it',
   case when to_regprocedure('public.consume_login_otp(uuid,text,integer,uuid)') is null then 'ABSENT'
        when has_function_privilege('service_role','public.consume_login_otp(uuid,text,integer,uuid)','EXECUTE')
        then 'PASS' else 'FAIL' end),

  -- login_otp was created out of band (OPS-01), so its real shape is not known
  -- from source. `create table if not exists` does NOT reshape an existing
  -- table, so if the live id column is not uuid, consume_login_otp compiles
  -- fine but every call fails on the p_challenge_id comparison.
  ('login_otp.id is uuid (required by p_challenge_id)',
   coalesce((select case when data_type = 'uuid' then 'PASS'
                         else 'FAIL — id is ' || data_type end
             from information_schema.columns
             where table_schema='public' and table_name='login_otp' and column_name='id'),
            'FAIL — no id column')),
  ('login_otp.created_at present (ordering for the legacy path)',
   case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='login_otp'
                       and column_name='created_at')
        then 'PASS' else 'FAIL' end)
) as t(check_name, result);

-- Actual live shape, for the record. Compare against the definition above.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'login_otp'
order by ordinal_position;
