-- Additive, operation-scoped email authorization. No legacy rows are reclassified.
begin;
create table public.ownership_email_challenges (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
 purpose text not null check (purpose in ('recover_library','claim_gift')),
 gift_id uuid references public.gifts(id) on delete cascade,
 handle_hash text not null check (handle_hash ~ '^[0-9a-f]{64}$'),
 code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
 targets jsonb not null check (jsonb_typeof(targets) = 'array' and jsonb_array_length(targets) between 1 and 200),
 state text not null default 'pending' check (state in ('pending','delivered','consumed','cancelled','locked')),
 attempts integer not null default 0 check (attempts between 0 and 5),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '5 minutes'),
 consumed_at timestamptz,
 check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
 check ((purpose = 'claim_gift') = (gift_id is not null)),
 check ((state = 'consumed') = (consumed_at is not null))
);
create unique index ownership_email_challenges_handle on public.ownership_email_challenges(handle_hash);
create index ownership_email_challenges_actor_created on public.ownership_email_challenges(user_id,created_at desc);
alter table public.ownership_email_challenges enable row level security;
revoke all on public.ownership_email_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.ownership_email_challenges to service_role;
comment on table public.ownership_email_challenges is 'Server-only hashes; no plaintext OTP or session credentials. Verification and ownership writes use one PostgreSQL transaction.';
commit;
-- Stop writers before retirement. Retain consumed receipts for investigation.
-- No automatic backfill: existing confirmed timestamps are not inbox proof.
