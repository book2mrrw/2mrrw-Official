-- Canonical metadata normalization — slugs, titles, release metadata, entity-folder paths.
-- Complements 20260529120000 / 20260529130000 / 20260529140000 (idempotent).
-- Rollback notes at bottom.

begin;

-- Ensure schema from prior canonical migrations exists.
alter table public.products
  add column if not exists release_date date,
  add column if not exists display_title text,
  add column if not exists artwork_path text,
  add column if not exists video_path text,
  add column if not exists album_slug text;

create table if not exists public.catalog_tracks (
  id uuid primary key default gen_random_uuid(),
  album_slug text not null,
  track_number integer not null check (track_number > 0),
  slug text not null,
  title text not null,
  display_title text,
  storage_path text,
  preview_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (album_slug, slug),
  unique (album_slug, track_number)
);

-- ── 1. Slug normalization ───────────────────────────────────────────────────
update public.products
set slug = 'tbh',
    updated_at = now()
where slug = 'tbh.h';

update public.products
set slug = 'love-hz-vol-1',
    title = 'Love Hz Vol. 1',
    display_title = 'Love Hz Vol. 1',
    metadata = coalesce(metadata, '{}'::jsonb) || '{"release_category":"EP","release_type":"mixtapes-and-eps","canonical":true}'::jsonb,
    updated_at = now()
where slug = 'love-hz';

update public.catalog_tracks
set album_slug = 'tbh',
    updated_at = now()
where album_slug in ('tbh.h', 'tbh');

update public.catalog_tracks
set album_slug = 'love-hz-vol-1',
    updated_at = now()
where album_slug = 'love-hz';

-- ── 2–3. Release metadata upsert (products) ───────────────────────────────────
insert into public.products (
  slug, title, display_title, product_type, price_cents, cover_url,
  storage_path, preview_path, artwork_path, video_path, release_date, metadata, active
)
values
  ('hour-glass', 'Hour Glass', 'Hour Glass', 'single', 299, '/images/singles/hourglass.jpg',
    'singles/hour-glass/', 'previews/singles/hour-glass/', 'images/singles/hour-glass/', 'videos/singles/hour-glass/',
    '2026-08-15', '{"release_type":"singles","release_category":"single","canonical":true}'::jsonb, true),
  ('w2d', 'W.2.D', 'W.2.D', 'single', 299, '/images/singles/w2d.jpg',
    'singles/w2d/', 'previews/singles/w2d/', 'images/singles/w2d/', 'videos/singles/w2d/',
    '2024-06-01', '{"release_type":"singles","release_category":"single","canonical":true}'::jsonb, true),
  ('turnt-me-2-dis', 'Turnt Me 2 Dis', 'Turnt Me 2 Dis', 'single', 299, '/images/singles/turnt.jpg',
    'singles/turnt-me-2-dis/', 'previews/singles/turnt-me-2-dis/', 'images/singles/turnt-me-2-dis/', 'videos/singles/turnt-me-2-dis/',
    '2026-08-01', '{"release_type":"singles","release_category":"single","canonical":true}'::jsonb, true),
  ('artificial', 'ArTiFiCiAL', 'ArTiFiCiAL', 'single', 299, '/images/singles/artificial.jpg',
    'singles/artificial/', 'previews/singles/artificial/', 'images/singles/artificial/', 'videos/singles/artificial/',
    '2022-07-07', '{"release_type":"singles","release_category":"single","canonical":true}'::jsonb, true),
  ('i-dont-believe-you', 'I Don''t Believe You', 'I Don''t Believe You', 'feature', 299, '/images/features/idbu.jpg',
    'features/i-dont-believe-you/', 'previews/features/i-dont-believe-you/', 'images/features/i-dont-believe-you/', null,
    '2024-01-15', '{"release_type":"features","release_category":"feature","canonical":true}'::jsonb, true),
  ('2-heavy', '2 Heavy', '2 Heavy', 'feature', 299, '/images/features/2heavy.jpg',
    'features/2-heavy/', 'previews/features/2-heavy/', 'images/features/2-heavy/', null,
    '2024-02-01', '{"release_type":"features","release_category":"feature","canonical":true}'::jsonb, true),
  ('love-hz-vol-1', 'Love Hz Vol. 1', 'Love Hz Vol. 1', 'album', 1299, '/images/albums/lovehz.jpg',
    null, null, 'images/mixtapes-and-eps/love-hz-vol-1/', 'videos/mixtapes-and-eps/love-hz-vol-1/',
    '2026-08-01', '{"release_type":"mixtapes-and-eps","release_category":"EP","canonical":true}'::jsonb, true),
  ('ad', '2MRRW: (A.D)', '2MRRW: (A.D)', 'album', 999, '/images/albums/ad.jpg',
    null, null, 'images/mixtapes-and-eps/ad/', 'videos/mixtapes-and-eps/ad/',
    '2024-03-24', '{"release_type":"mixtapes-and-eps","release_category":"Mixtape","canonical":true}'::jsonb, true),
  ('tbh', 'T.B.H', 'T.B.H', 'album', 999, '/images/albums/tbh.jpg',
    null, null, 'images/mixtapes-and-eps/tbh/', 'videos/mixtapes-and-eps/tbh/',
    '2022-07-07', '{"release_type":"mixtapes-and-eps","release_category":"Mixtape","canonical":true}'::jsonb, true)
on conflict (slug) do update set
  title = excluded.title,
  display_title = excluded.display_title,
  product_type = excluded.product_type,
  price_cents = excluded.price_cents,
  cover_url = excluded.cover_url,
  storage_path = coalesce(excluded.storage_path, products.storage_path),
  preview_path = coalesce(excluded.preview_path, products.preview_path),
  artwork_path = excluded.artwork_path,
  video_path = coalesce(excluded.video_path, products.video_path),
  release_date = excluded.release_date,
  metadata = products.metadata || excluded.metadata,
  active = true,
  updated_at = now();

-- Title-only corrections for canonical rows (never derive from slug).
update public.products set title = 'Hour Glass', display_title = 'Hour Glass', updated_at = now() where slug = 'hour-glass';
update public.products set title = 'W.2.D', display_title = 'W.2.D', updated_at = now() where slug = 'w2d';
update public.products set title = 'Turnt Me 2 Dis', display_title = 'Turnt Me 2 Dis', updated_at = now() where slug = 'turnt-me-2-dis';
update public.products set title = 'ArTiFiCiAL', display_title = 'ArTiFiCiAL', updated_at = now() where slug = 'artificial';
update public.products set title = 'I Don''t Believe You', display_title = 'I Don''t Believe You', updated_at = now() where slug = 'i-dont-believe-you';
update public.products set title = '2 Heavy', display_title = '2 Heavy', updated_at = now() where slug = '2-heavy';
update public.products set title = 'Love Hz Vol. 1', display_title = 'Love Hz Vol. 1', updated_at = now() where slug = 'love-hz-vol-1';
update public.products set title = '2MRRW: (A.D)', display_title = '2MRRW: (A.D)', updated_at = now() where slug = 'ad';
update public.products set title = 'T.B.H', display_title = 'T.B.H', updated_at = now() where slug = 'tbh';

-- ── 4. Track metadata upsert (catalog_tracks) ─────────────────────────────────
insert into public.catalog_tracks (album_slug, track_number, slug, title, display_title, storage_path, preview_path)
values
  ('love-hz-vol-1', 1, '01-roll-call', 'Roll Call', 'Roll Call', 'mixtapes-and-eps/love-hz-vol-1/01-roll-call/', 'previews/mixtapes-and-eps/love-hz-vol-1/01-roll-call/'),
  ('love-hz-vol-1', 2, '02-w-2-d', 'W.2.D', 'W.2.D', 'mixtapes-and-eps/love-hz-vol-1/02-w-2-d/', 'previews/mixtapes-and-eps/love-hz-vol-1/02-w-2-d/'),
  ('love-hz-vol-1', 3, '03-guarded-heart', 'Guarded Heart', 'Guarded Heart', 'mixtapes-and-eps/love-hz-vol-1/03-guarded-heart/', 'previews/mixtapes-and-eps/love-hz-vol-1/03-guarded-heart/'),
  ('love-hz-vol-1', 4, '04-all-love-it', 'All Love It', 'All Love It', 'mixtapes-and-eps/love-hz-vol-1/04-all-love-it/', 'previews/mixtapes-and-eps/love-hz-vol-1/04-all-love-it/'),
  ('love-hz-vol-1', 5, '05-like-u-do', 'Like U Do', 'Like U Do', 'mixtapes-and-eps/love-hz-vol-1/05-like-u-do/', 'previews/mixtapes-and-eps/love-hz-vol-1/05-like-u-do/'),
  ('love-hz-vol-1', 6, '06-tell-me', 'Tell Me', 'Tell Me', 'mixtapes-and-eps/love-hz-vol-1/06-tell-me/', 'previews/mixtapes-and-eps/love-hz-vol-1/06-tell-me/'),
  ('love-hz-vol-1', 7, '07-stayed-2-long', 'Stayed 2 Long', 'Stayed 2 Long', 'mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/', 'previews/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/'),
  ('love-hz-vol-1', 8, '08-knock-on-wood', 'Knock On Wood', 'Knock On Wood', 'mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/', 'previews/mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/'),
  ('love-hz-vol-1', 9, '09-hour-glass', 'Hour Glass', 'Hour Glass', 'mixtapes-and-eps/love-hz-vol-1/09-hour-glass/', 'previews/mixtapes-and-eps/love-hz-vol-1/09-hour-glass/'),
  ('love-hz-vol-1', 10, '10-turnt-me-2-dis', 'Turnt Me 2 Dis', 'Turnt Me 2 Dis', 'mixtapes-and-eps/love-hz-vol-1/10-turnt-me-2-dis/', 'previews/mixtapes-and-eps/love-hz-vol-1/10-turnt-me-2-dis/'),
  ('ad', 1, '01-2mrrws-ntro', '2mrrw''s Ntro', '2mrrw''s Ntro', 'mixtapes-and-eps/ad/01-2mrrws-ntro/', 'previews/mixtapes-and-eps/ad/01-2mrrws-ntro/'),
  ('ad', 2, '02-here-i-come', 'Here I Come', 'Here I Come', 'mixtapes-and-eps/ad/02-here-i-come/', 'previews/mixtapes-and-eps/ad/02-here-i-come/'),
  ('ad', 3, '03-said-n-done', 'Said N'' Done', 'Said N'' Done', 'mixtapes-and-eps/ad/03-said-n-done/', 'previews/mixtapes-and-eps/ad/03-said-n-done/'),
  ('ad', 4, '04-a-d-d', 'A.D.D', 'A.D.D', 'mixtapes-and-eps/ad/04-a-d-d/', 'previews/mixtapes-and-eps/ad/04-a-d-d/'),
  ('ad', 5, '05-perspective', 'Perspective', 'Perspective', 'mixtapes-and-eps/ad/05-perspective/', 'previews/mixtapes-and-eps/ad/05-perspective/'),
  ('ad', 6, '06-grand-scheme', 'Grand Scheme', 'Grand Scheme', 'mixtapes-and-eps/ad/06-grand-scheme/', 'previews/mixtapes-and-eps/ad/06-grand-scheme/'),
  ('ad', 7, '07-a2b', 'A2B', 'A2B', 'mixtapes-and-eps/ad/07-a2b/', 'previews/mixtapes-and-eps/ad/07-a2b/'),
  ('ad', 8, '08-life-changes-ft-gwendolyn', 'Life Changes ft. Gwendolyn', 'Life Changes ft. Gwendolyn', 'mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/', 'previews/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/'),
  ('ad', 9, '09-itself', 'Itself', 'Itself', 'mixtapes-and-eps/ad/09-itself/', 'previews/mixtapes-and-eps/ad/09-itself/'),
  ('ad', 10, '10-wastin-time', 'Wastin'' Time', 'Wastin'' Time', 'mixtapes-and-eps/ad/10-wastin-time/', 'previews/mixtapes-and-eps/ad/10-wastin-time/'),
  ('ad', 11, '11-like-me-or-not', 'Like Me or Not', 'Like Me or Not', 'mixtapes-and-eps/ad/11-like-me-or-not/', 'previews/mixtapes-and-eps/ad/11-like-me-or-not/'),
  ('tbh', 1, '01-glass-full', 'Glass Full', 'Glass Full', 'mixtapes-and-eps/tbh/01-glass-full/', 'previews/mixtapes-and-eps/tbh/01-glass-full/'),
  ('tbh', 2, '02-up-2-me', 'Up 2 Me', 'Up 2 Me', 'mixtapes-and-eps/tbh/02-up-2-me/', 'previews/mixtapes-and-eps/tbh/02-up-2-me/'),
  ('tbh', 3, '03-unxpcted', 'Unxpcted', 'Unxpcted', 'mixtapes-and-eps/tbh/03-unxpcted/', 'previews/mixtapes-and-eps/tbh/03-unxpcted/'),
  ('tbh', 4, '04-all-yours', 'All Yours', 'All Yours', 'mixtapes-and-eps/tbh/04-all-yours/', 'previews/mixtapes-and-eps/tbh/04-all-yours/'),
  ('tbh', 5, '05-locomotive', 'Locomotive', 'Locomotive', 'mixtapes-and-eps/tbh/05-locomotive/', 'previews/mixtapes-and-eps/tbh/05-locomotive/'),
  ('tbh', 6, '06-left', 'LEFT (interlude)', 'LEFT (interlude)', 'mixtapes-and-eps/tbh/06-left/', 'previews/mixtapes-and-eps/tbh/06-left/'),
  ('tbh', 7, '07-was-wrong', 'Was Wrong', 'Was Wrong', 'mixtapes-and-eps/tbh/07-was-wrong/', 'previews/mixtapes-and-eps/tbh/07-was-wrong/'),
  ('tbh', 8, '08-2late', '2Late?', '2Late?', 'mixtapes-and-eps/tbh/08-2late/', 'previews/mixtapes-and-eps/tbh/08-2late/'),
  ('tbh', 9, '09-artificial', 'ArTiFiCiAL', 'ArTiFiCiAL', 'mixtapes-and-eps/tbh/09-artificial/', 'previews/mixtapes-and-eps/tbh/09-artificial/')
on conflict (album_slug, slug) do update set
  track_number = excluded.track_number,
  title = excluded.title,
  display_title = excluded.display_title,
  storage_path = excluded.storage_path,
  preview_path = excluded.preview_path,
  updated_at = now();

-- ── 5. Entity-folder path enforcement (strip filenames / wrong roots) ───────
create or replace function public.strip_media_filename(path text)
returns text
language sql
immutable
as $$
  select case
    when path is null or path = '' then path
    when path ~* '\.(wav|flac|m4a|mp3|jpg|jpeg|png|webp|mp4|webm|mov|json|dat|peak)$'
      then regexp_replace(
        path,
        '/[^/]+\.(wav|flac|m4a|mp3|jpg|jpeg|png|webp|mp4|webm|mov|json|dat|peak)$',
        '',
        'i'
      )
    else regexp_replace(path, '/$', '')
  end;
$$;

update public.products
set storage_path = regexp_replace(public.strip_media_filename(storage_path) || '/', '^digital-assets/', '')
where slug in ('hour-glass', 'w2d', 'turnt-me-2-dis', 'artificial', 'i-dont-believe-you', '2-heavy')
  and storage_path is not null;

update public.products
set preview_path = public.strip_media_filename(preview_path) || '/'
where preview_path is not null
  and slug in ('hour-glass', 'w2d', 'turnt-me-2-dis', 'artificial', 'i-dont-believe-you', '2-heavy');

update public.products
set artwork_path = public.strip_media_filename(artwork_path) || '/'
where artwork_path is not null
  and slug in (
    'hour-glass', 'w2d', 'turnt-me-2-dis', 'artificial',
    'i-dont-believe-you', '2-heavy', 'love-hz-vol-1', 'ad', 'tbh'
  );

update public.products
set video_path = public.strip_media_filename(video_path) || '/'
where video_path is not null
  and slug in ('hour-glass', 'w2d', 'turnt-me-2-dis', 'artificial', 'love-hz-vol-1', 'ad', 'tbh');

update public.catalog_tracks
set storage_path = regexp_replace(public.strip_media_filename(storage_path) || '/', '^digital-assets/', ''),
    preview_path = public.strip_media_filename(preview_path) || '/'
where album_slug in ('love-hz-vol-1', 'ad', 'tbh');

-- Fix feature rows that still point at singles/ storage roots.
update public.products
set storage_path = 'features/' || slug || '/',
    preview_path = 'previews/features/' || slug || '/',
    artwork_path = 'images/features/' || slug || '/',
    metadata = coalesce(metadata, '{}'::jsonb) || '{"release_type":"features","release_category":"feature","canonical":true}'::jsonb,
    updated_at = now()
where product_type = 'feature'
  and slug in ('i-dont-believe-you', '2-heavy')
  and (
    storage_path is null
    or storage_path ~* '^singles/'
    or storage_path !~* '^features/'
  );

drop function if exists public.strip_media_filename(text);

commit;

-- ── Rollback (manual; not auto-run) ───────────────────────────────────────────
-- To revert slug/title/path changes, restore from a pre-migration backup or:
--   UPDATE products SET slug = 'tbh.h' WHERE slug = 'tbh' AND metadata->>'migrated_from' = 'tbh.h';
-- Re-run prior migration snapshots from git:
--   20260529120000_canonical_media_metadata.sql
--   20260529130000_entity_folder_paths.sql
-- Product rows not in the canonical list are untouched by this migration.
