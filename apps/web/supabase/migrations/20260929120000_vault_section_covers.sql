-- Vault section covers.
--
-- The still or short loop a pod shows on its shelf before it is summoned, so
-- a section never sits there blank.
--
-- Its own table rather than rows in vault_content: a section cover is
-- chrome, not an item in the archive. Putting it in vault_content would make
-- it show up in every listing, count toward a section's contents, and need
-- an access_tier it has no use for. One row per section, keyed by the same
-- category string the app already uses.

create table if not exists public.vault_section_covers (
  category    text primary key,
  -- The animated loop, if there is one. mp4/webm only.
  motion_key  text,
  -- The still. Doubles as the <video poster> and as the fallback when the
  -- motion source fails, so a section with motion should have one too.
  still_key   text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

comment on table public.vault_section_covers is
  'Per-section cover art for the Vault chamber pods. Separate from vault_content: chrome, not archive items.';
comment on column public.vault_section_covers.motion_key is
  'R2 key under videos/vault/_section-covers/. Entitlement-gated prefix; never publicly cached.';
comment on column public.vault_section_covers.still_key is
  'R2 key for the poster/fallback image. Required whenever motion_key is set.';

alter table public.vault_section_covers enable row level security;

-- Reads and writes go through the service role only. The public surface gets
-- these through /api/public/vault, which already resolves entitlement; no
-- anon client should be querying storage keys directly.
drop policy if exists "vault_section_covers service role" on public.vault_section_covers;
create policy "vault_section_covers service role"
  on public.vault_section_covers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
