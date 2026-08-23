-- ============================================================================
-- E0 — Entitlement Authority Hardening
-- Closes ENT-01 (profiles.role self-promotion) and ENT-13 (slug-prefix
-- collector authority). Establishes INV-ENT-1, INV-ENT-2 and INV-ENT-6.
--
-- SAFE TO RE-RUN. Every statement is idempotent.
--
-- ── Why this migration exists ───────────────────────────────────────────────
-- The policy `profiles_update_own` was declared as:
--
--     for update using (auth.uid() = id)
--
-- with no WITH CHECK clause and no column restriction. PostgreSQL reuses the
-- USING expression as the WITH CHECK expression when the latter is omitted, so
-- the new row only has to satisfy `auth.uid() = id` — which it still does after
-- changing any other column. `profiles.role` therefore became client-writable,
-- and `role in ('user','admin')` explicitly permits 'admin'.
--
-- Any authenticated browser session could run:
--     supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
-- and thereby satisfy isAdminUser(), every /api/admin/* route, and every RLS
-- policy shaped `EXISTS (... profiles WHERE id = auth.uid() AND role='admin')`.
--
-- ── Defence in depth: three independent barriers ────────────────────────────
--   1. admin_principals   — new server-only table; the real source of authority
--   2. column privileges  — authenticated loses UPDATE on profiles.role
--   3. guard trigger      — rejects any role mutation not made by service_role
--
-- Barrier 1 makes the other two non-load-bearing for NEW code, but 2 and 3
-- protect every existing RLS policy in the schema that still reads
-- profiles.role, so all three are required until those policies are migrated.
-- ============================================================================

begin;

-- ── 1. Server-controlled admin authority ───────────────────────────────────
-- The browser has no SQL path to this table at all. Elevation requires the
-- service key, i.e. server code or an operator.

create table if not exists public.admin_principals (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users (id) on delete set null,
  note        text
);

comment on table public.admin_principals is
  'INV-ENT-2: the only source of administrative authority. Server-controlled; '
  'no client role has any privilege on this table. Never expose through PostgREST '
  'to authenticated or anon.';

alter table public.admin_principals enable row level security;

-- No policies are created. With RLS enabled and zero policies, every non-superuser
-- role is denied. service_role bypasses RLS, so server code retains full access.
-- Belt and braces: strip the default PostgREST grants as well.
revoke all on public.admin_principals from anon;
revoke all on public.admin_principals from authenticated;

-- Backfill existing admins so this migration cannot lock the operator out.
insert into public.admin_principals (user_id, note)
select p.id, 'backfilled from profiles.role during E0 hardening'
from public.profiles p
where p.role = 'admin'
on conflict (user_id) do nothing;


-- ── 2. Column-level privileges on profiles ─────────────────────────────────
-- Remove blanket UPDATE from client roles and re-grant only the columns a user
-- legitimately edits. A column added in future is NOT updatable by clients until
-- explicitly granted — deny-by-default, which is the correct failure direction.

do $$
declare
  grantable text[] := array[
    'full_name','phone','avatar_url','bio','city','state','country',
    'legal_name','contact_email','marketing_opt_in','updated_at'
  ];
  col text;
begin
  -- Only proceed if the profiles table exists.
  if to_regclass('public.profiles') is null then
    raise notice 'public.profiles not found — skipping column privilege hardening';
    return;
  end if;

  revoke update on public.profiles from authenticated;

  foreach col in array grantable loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = col
    ) then
      execute format('grant update (%I) on public.profiles to authenticated', col);
    end if;
  end loop;
end $$;


-- ── 3. Guard trigger — role is server-controlled ───────────────────────────
-- RLS policies cannot express "any column except role", and column privileges
-- are bypassed by anything holding broader grants. This trigger is the backstop:
-- it fires for every writer except service_role.

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
begin
  if new.role is distinct from old.role and caller <> 'service_role' then
    raise exception
      'profiles.role is server-controlled and cannot be modified by clients (INV-ENT-1)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.profiles_guard_privileged_columns() is
  'INV-ENT-1: rejects client-originated mutation of profiles.role. service_role '
  'is exempt so server code and migrations continue to work.';

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();


-- ── 4. Tighten the update policy itself ────────────────────────────────────
-- Explicit WITH CHECK so the intent is stated rather than inherited from USING.
-- This does not by itself prevent role changes (see header) — barriers 2 and 3 do.

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ── 5. ENT-13 — typed collector authority ──────────────────────────────────
-- Application code already reads products.is_collector_product and treats NULL
-- as "migration pending", falling back to slug prefixes (exc-bundle / exc-card /
-- collector-). That column was never actually created, so the slug heuristic has
-- been the live authority. Create it, backfill from the historical prefixes once,
-- then make the column NOT NULL so authorization can never again depend on naming.

do $$
begin
  if to_regclass('public.products') is null then
    raise notice 'public.products not found — skipping collector column';
    return;
  end if;

  alter table public.products
    add column if not exists is_collector_product boolean;

  -- One-time backfill using the legacy prefixes. After this, naming is inert.
  update public.products
     set is_collector_product = true
   where is_collector_product is null
     and (slug like 'exc-bundle%' or slug like 'exc-card%' or slug like 'collector-%');

  update public.products
     set is_collector_product = false
   where is_collector_product is null;

  alter table public.products
    alter column is_collector_product set default false;
  alter table public.products
    alter column is_collector_product set not null;
end $$;

comment on column public.products.is_collector_product is
  'INV-ENT-6: the ONLY source of collector capability for a product. Catalog slug '
  'naming must never confer authorization.';

commit;

-- ============================================================================
-- POST-MIGRATION VERIFICATION — run these and confirm the expected results.
-- ============================================================================
--
-- 1) Admin backfill landed (expect >= 1 row, including your own account):
--      select p.email, ap.granted_at
--      from public.admin_principals ap
--      join public.profiles p on p.id = ap.user_id;
--
-- 2) Escalation is blocked. Run as an ORDINARY logged-in user (anon key + their
--    JWT), NOT the service key. Expect error 42501:
--      update public.profiles set role = 'admin' where id = auth.uid();
--
-- 3) Ordinary profile edits still work for that same user (expect success):
--      update public.profiles set full_name = 'test' where id = auth.uid();
--
-- 4) admin_principals is unreachable from the client (expect zero rows/denied):
--      select * from public.admin_principals;
--
-- 5) Collector column is populated and non-null:
--      select is_collector_product, count(*)
--      from public.products group by 1;
-- ============================================================================
