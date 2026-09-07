-- Adds a human-readable slug to audio_visuals and audio_visual_seriez —
-- the primary human-facing identifier, exactly like releases.slug: assigned
-- automatically at draft-creation time (see the new
-- /api/admin/audio-visual/draft route, mirroring
-- /api/admin/releases/draft's own title-to-slug + dedup logic), never left
-- unset. It drives the R2 storage path in the 2mrrw-media bucket
-- ("2MRRW Studios/{content-type folder}/{slug}/..." or, for an episode,
-- ".../Seriez/{seriez-slug}/{episode-slug}/").
--
-- This is NOT a reversal of this schema's earlier, deliberate "stable UUID,
-- never slug" decision for DATABASE RELATIONSHIPS — audio_visuals.id
-- remains the only identity used for FKs, entitlements, and signed tokens,
-- exactly as before. slug is the primary identifier a human or a storage
-- path uses; id is the primary identifier the security/data model uses.
-- Releases work the same way (a real, meaningful slug AND a UUID that's
-- what every FK actually points at) — this isn't a special case.
--
-- public.audio_visuals and public.audio_visual_seriez both have zero rows
-- in production as of this migration (confirmed live, same as every prior
-- Audio Visual migration this session), so NOT NULL UNIQUE can be added
-- directly — no backfill needed.
alter table public.audio_visuals
  add column if not exists slug text;

alter table public.audio_visual_seriez
  add column if not exists slug text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.audio_visuals'::regclass and conname = 'audio_visuals_slug_format_check'
  ) then
    alter table public.audio_visuals
      add constraint audio_visuals_slug_format_check
      check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$');
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.audio_visual_seriez'::regclass and conname = 'audio_visual_seriez_slug_format_check'
  ) then
    alter table public.audio_visual_seriez
      add constraint audio_visual_seriez_slug_format_check
      check (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$');
  end if;
end $$;

alter table public.audio_visuals
  alter column slug set not null;

alter table public.audio_visual_seriez
  alter column slug set not null;

create unique index if not exists idx_audio_visuals_slug_unique
  on public.audio_visuals (slug);

create unique index if not exists idx_audio_visual_seriez_slug_unique
  on public.audio_visual_seriez (slug);
