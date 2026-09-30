-- Vault categories -> the eight canonical Z-suffixed names.
--
-- `vault_content.category` is the string the Vault renders as a section
-- heading, so this is purely a display rename plus two deliberate merges.
-- No rows are deleted and no content moves: every vault R2 folder was
-- verified empty (0 bytes) on 2026-09-27, so nothing depends on the old names.
--
-- The eight:
--   1 Audio Diariez         5 Archive Sessionz
--   2 Behind the Scenez     6 Documentariez
--   3 Exclusive Interviewz  7 Private Releasez
--   4 Live Replayz          8 UNMXD UNMSTRD
--
-- Two merges, both requested explicitly:
--   Studio Sessions      -> Archive Sessionz  (one archive, not two)
--   Collective Broadcasts -> Live Replayz     (a broadcast is a replay)

begin;

-- ── 1. Rename in place ──────────────────────────────────────────────────────
update public.vault_content set category = 'Audio Diariez'
  where category in ('Audio Diaries', 'Audio Diariez');

update public.vault_content set category = 'Exclusive Interviewz'
  where category in ('Exclusive Interviews', 'Exclusive Interviewz');

update public.vault_content set category = 'Behind the Scenez'
  where category in ('BTS', 'Behind The Scenes', 'Behind the Scenes', 'Behind the Scenez');

update public.vault_content set category = 'Live Replayz'
  where category in ('Premium Livestream Replays', 'Live Replays',
                     'Collective Broadcasts', 'Live Replayz');

update public.vault_content set category = 'Archive Sessionz'
  where category in ('Archives', 'Archive Sessions', 'Studio Sessions', 'Archive Sessionz');

update public.vault_content set category = 'UNMXD UNMSTRD'
  where category in ('Unreleased Archives', 'Unreleased', 'UNMXD UNMSTRD');

update public.vault_content set category = 'Documentariez'
  where category in ('Documentaries', 'Documentariez');

update public.vault_content set category = 'Private Releasez'
  where category in ('Private Releases', 'Private Releasez');

-- ── 2. Seed the two categories that have R2 folders but no rows ─────────────
-- videos/vault/documentaries/ and videos/vault/private-releases/ exist in the
-- bucket with no matching vault_content row, so those sections could never
-- render. Placeholder copy — edit freely in admin; the point here is that the
-- category exists and is wired, not that the words are final.
insert into public.vault_content
  (slug, category, title, description, access_tier, media_type, atmosphere,
   behavior, cover_url, sort_order, featured, visibility, published_at, metadata)
values
  ('documentariez-long-form', 'Documentariez', 'Long Form',
   'Documentary-length pieces: full stories, not clips.',
   'vault_pass', 'video', 'Cinematic · Deliberate · Long Form', 'video',
   '/images/albums/ad.jpg', 60, false, 'published', now(),
   '{"seed":true,"created_by":"vault-category-rename"}'::jsonb),
  ('private-releasez-unlisted', 'Private Releasez', 'Unlisted',
   'Releases that live only here — never on the public catalog.',
   'inner_circle', 'audio', 'Exclusive · Unlisted · Intimate', 'audio',
   '/images/albums/tbh.jpg', 80, false, 'published', now(),
   '{"seed":true,"created_by":"vault-category-rename"}'::jsonb)
on conflict (slug) do update
  set category = excluded.category,
      title    = excluded.title;

commit;

-- ── Deliberately untouched ──────────────────────────────────────────────────
-- Creative Process, Director Commentary, Visual Concepts, Vault Notes and
-- Future Drops are NOT in the eight and are NOT deleted here. Dropping rows is
-- irreversible and was never asked for; they simply keep their current names
-- until there is a decision. To hide one without losing it:
--
--   update public.vault_content set visibility = 'hidden'
--     where category = 'Creative Process';
