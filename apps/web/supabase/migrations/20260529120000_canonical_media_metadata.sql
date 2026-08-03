-- Canonical media metadata — products extensions + catalog_tracks (idempotent).

alter table public.products
  add column if not exists release_date date,
  add column if not exists display_title text,
  add column if not exists artwork_path text,
  add column if not exists video_path text,
  add column if not exists album_slug text;

comment on column public.products.display_title is 'Authoritative display title — never derived from slug in UI.';
comment on column public.products.artwork_path is 'Canonical R2 key under images/.';
comment on column public.products.video_path is 'Canonical R2 key under videos/.';
comment on column public.products.album_slug is 'Parent album slug for track-level product rows.';

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

create index if not exists catalog_tracks_album_idx
  on public.catalog_tracks (album_slug, track_number asc);

alter table public.catalog_tracks enable row level security;

drop policy if exists "catalog_tracks_public_read" on public.catalog_tracks;
create policy "catalog_tracks_public_read" on public.catalog_tracks
  for select using (true);

-- Rename legacy love-hz product slug → love-hz-vol-1 when present.
update public.products
set slug = 'love-hz-vol-1',
    title = 'Love Hz Vol. 1',
    display_title = 'Love Hz Vol. 1',
    metadata = coalesce(metadata, '{}'::jsonb) || '{"release_category":"EP","canonical":true}'::jsonb
where slug = 'love-hz';

-- ── SINGLES ─────────────────────────────────────────────────────────────────
insert into public.products (slug, title, display_title, product_type, price_cents, cover_url, storage_path, preview_path, artwork_path, video_path, release_date, metadata, active)
values
  ('hour-glass', 'Hour Glass', 'Hour Glass', 'single', 299, '/images/singles/hourglass.jpg', 'singles/hour-glass/audio.wav', 'previews/hourglass-preview.mp3', 'images/singles/hour-glass/artwork.jpg', 'videos/singles/hour-glass/loop.mp4', '2026-08-15', '{"release_category":"single","canonical":true}'::jsonb, true),
  ('w2d', 'W.2.D', 'W.2.D', 'single', 299, '/images/singles/w2d.jpg', 'singles/w2d/audio.wav', 'previews/w2d-preview.mp3', 'images/singles/w2d/artwork.jpg', 'videos/singles/w2d/loop.mp4', '2024-06-01', '{"release_category":"single","canonical":true}'::jsonb, true),
  ('artificial', 'ArTiFiCiAL', 'ArTiFiCiAL', 'single', 299, '/images/singles/artificial.jpg', 'singles/artificial/audio.wav', 'previews/artificial-preview.mp3', 'images/singles/artificial/artwork.jpg', 'videos/singles/artificial/loop.mp4', '2022-07-07', '{"release_category":"single","canonical":true}'::jsonb, true),
  ('turnt-me-2-dis', 'Turnt Me 2 Dis', 'Turnt Me 2 Dis', 'single', 299, '/images/singles/turnt.jpg', 'singles/turnt-me-2-dis/audio.wav', 'previews/turntme2dis-preview.mp3', 'images/singles/turnt-me-2-dis/artwork.jpg', 'videos/singles/turnt-me-2-dis/loop.mp4', '2026-08-01', '{"release_category":"single","canonical":true}'::jsonb, true)
on conflict (slug) do update set
  title = excluded.title,
  display_title = excluded.display_title,
  product_type = excluded.product_type,
  price_cents = excluded.price_cents,
  cover_url = excluded.cover_url,
  storage_path = excluded.storage_path,
  preview_path = excluded.preview_path,
  artwork_path = excluded.artwork_path,
  video_path = excluded.video_path,
  release_date = excluded.release_date,
  metadata = products.metadata || excluded.metadata,
  active = true,
  updated_at = now();

-- ── FEATURES (digital-assets/features/, NOT singles/) ───────────────────────
insert into public.products (slug, title, display_title, product_type, price_cents, cover_url, storage_path, preview_path, artwork_path, release_date, metadata, active)
values
  ('i-dont-believe-you', 'I Don''t Believe You', 'I Don''t Believe You', 'feature', 299, '/images/features/idbu.jpg', 'features/i-dont-believe-you/audio.wav', 'previews/i-dont-believe-you-preview.wav', 'images/features/i-dont-believe-you/artwork.jpg', '2024-01-15', '{"release_category":"feature","canonical":true}'::jsonb, true),
  ('2-heavy', '2 Heavy', '2 Heavy', 'feature', 299, '/images/features/2heavy.jpg', 'features/2-heavy/audio.wav', 'previews/2-heavy-preview.wav', 'images/features/2-heavy/artwork.jpg', '2024-02-01', '{"release_category":"feature","canonical":true}'::jsonb, true)
on conflict (slug) do update set
  title = excluded.title,
  display_title = excluded.display_title,
  product_type = excluded.product_type,
  price_cents = excluded.price_cents,
  cover_url = excluded.cover_url,
  storage_path = excluded.storage_path,
  preview_path = excluded.preview_path,
  artwork_path = excluded.artwork_path,
  release_date = excluded.release_date,
  metadata = products.metadata || excluded.metadata,
  active = true,
  updated_at = now();

-- Fix legacy feature paths that pointed at singles/
update public.products
set storage_path = 'features/i-dont-believe-you/audio.wav'
where slug = 'i-dont-believe-you'
  and (storage_path is null or storage_path like '%singles/i-dont-believe-you%');

update public.products
set storage_path = 'features/2-heavy/audio.wav'
where slug = '2-heavy'
  and (storage_path is null or storage_path like '%singles/2-heavy%');

-- ── ALBUMS / EPs / MIXTAPES ─────────────────────────────────────────────────
insert into public.products (slug, title, display_title, product_type, price_cents, cover_url, artwork_path, release_date, metadata, active)
values
  ('love-hz-vol-1', 'Love Hz Vol. 1', 'Love Hz Vol. 1', 'album', 1299, '/images/albums/lovehz.jpg', 'images/mixtapes-and-eps/love-hz-vol-1/artwork.jpg', '2026-08-01', '{"release_category":"EP","canonical":true}'::jsonb, true),
  ('ad', '2MRRW: (A.D)', '2MRRW: (A.D)', 'album', 999, '/images/albums/ad.jpg', 'images/mixtapes-and-eps/ad/artwork.jpg', '2024-03-24', '{"release_category":"Mixtape","canonical":true}'::jsonb, true),
  ('tbh', 'T.B.H', 'T.B.H', 'album', 999, '/images/albums/tbh.jpg', 'images/mixtapes-and-eps/tbh/artwork.jpg', '2022-07-07', '{"release_category":"Mixtape","canonical":true}'::jsonb, true)
on conflict (slug) do update set
  title = excluded.title,
  display_title = excluded.display_title,
  product_type = excluded.product_type,
  price_cents = excluded.price_cents,
  cover_url = excluded.cover_url,
  artwork_path = excluded.artwork_path,
  release_date = excluded.release_date,
  metadata = products.metadata || excluded.metadata,
  active = true,
  updated_at = now();

-- ── CATALOG TRACKS ──────────────────────────────────────────────────────────
insert into public.catalog_tracks (album_slug, track_number, slug, title, display_title, storage_path)
values
  ('love-hz-vol-1', 1, '01-roll-call', 'Roll Call', 'Roll Call', 'mixtapes-and-eps/love-hz-vol-1/01-roll-call/audio.wav'),
  ('love-hz-vol-1', 2, '02-w-2-d', 'W.2.D', 'W.2.D', 'mixtapes-and-eps/love-hz-vol-1/02-w-2-d/audio.wav'),
  ('love-hz-vol-1', 3, '03-guarded-heart', 'Guarded Heart', 'Guarded Heart', 'mixtapes-and-eps/love-hz-vol-1/03-guarded-heart/audio.wav'),
  ('love-hz-vol-1', 4, '04-all-love-it', 'All Love It', 'All Love It', 'mixtapes-and-eps/love-hz-vol-1/04-all-love-it/audio.wav'),
  ('love-hz-vol-1', 5, '05-like-u-do', 'Like U Do', 'Like U Do', 'mixtapes-and-eps/love-hz-vol-1/05-like-u-do/audio.wav'),
  ('love-hz-vol-1', 6, '06-tell-me', 'Tell Me', 'Tell Me', 'mixtapes-and-eps/love-hz-vol-1/06-tell-me/audio.wav'),
  ('love-hz-vol-1', 7, '07-stayed-2-long', 'Stayed 2 Long', 'Stayed 2 Long', 'mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/audio.wav'),
  ('love-hz-vol-1', 8, '08-knock-on-wood', 'Knock On Wood', 'Knock On Wood', 'mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/audio.wav'),
  ('love-hz-vol-1', 9, '09-hour-glass', 'Hour Glass', 'Hour Glass', 'mixtapes-and-eps/love-hz-vol-1/09-hour-glass/audio.wav'),
  ('love-hz-vol-1', 10, '10-turnt-me-2-dis', 'Turnt Me 2 Dis', 'Turnt Me 2 Dis', 'mixtapes-and-eps/love-hz-vol-1/10-turnt-me-2-dis/audio.wav'),
  ('ad', 1, '01-2mrrws-ntro', '2mrrw''s Ntro', '2mrrw''s Ntro', 'mixtapes-and-eps/ad/01-2mrrws-ntro/audio.wav'),
  ('ad', 2, '02-here-i-come', 'Here I Come', 'Here I Come', 'mixtapes-and-eps/ad/02-here-i-come/audio.wav'),
  ('ad', 3, '03-said-n-done', 'Said N'' Done', 'Said N'' Done', 'mixtapes-and-eps/ad/03-said-n-done/audio.wav'),
  ('ad', 4, '04-a-d-d', 'A.D.D', 'A.D.D', 'mixtapes-and-eps/ad/04-a-d-d/audio.wav'),
  ('ad', 5, '05-perspective', 'Perspective', 'Perspective', 'mixtapes-and-eps/ad/05-perspective/audio.wav'),
  ('ad', 6, '06-grand-scheme', 'Grand Scheme', 'Grand Scheme', 'mixtapes-and-eps/ad/06-grand-scheme/audio.wav'),
  ('ad', 7, '07-a2b', 'A2B', 'A2B', 'mixtapes-and-eps/ad/07-a2b/audio.wav'),
  ('ad', 8, '08-life-changes-ft-gwendolyn', 'Life Changes ft. Gwendolyn', 'Life Changes ft. Gwendolyn', 'mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/audio.wav'),
  ('ad', 9, '09-itself', 'Itself', 'Itself', 'mixtapes-and-eps/ad/09-itself/audio.wav'),
  ('ad', 10, '10-wastin-time', 'Wastin'' Time', 'Wastin'' Time', 'mixtapes-and-eps/ad/10-wastin-time/audio.wav'),
  ('ad', 11, '11-like-me-or-not', 'Like Me or Not', 'Like Me or Not', 'mixtapes-and-eps/ad/11-like-me-or-not/audio.wav'),
  ('tbh', 1, '01-glass-full', 'Glass Full', 'Glass Full', 'mixtapes-and-eps/tbh/01-glass-full/audio.wav'),
  ('tbh', 2, '02-up-2-me', 'Up 2 Me', 'Up 2 Me', 'mixtapes-and-eps/tbh/02-up-2-me/audio.wav'),
  ('tbh', 3, '03-unxpcted', 'Unxpcted', 'Unxpcted', 'mixtapes-and-eps/tbh/03-unxpcted/audio.wav'),
  ('tbh', 4, '04-all-yours', 'All Yours', 'All Yours', 'mixtapes-and-eps/tbh/04-all-yours/audio.wav'),
  ('tbh', 5, '05-locomotive', 'Locomotive', 'Locomotive', 'mixtapes-and-eps/tbh/05-locomotive/audio.wav'),
  ('tbh', 6, '06-left', 'LEFT (interlude)', 'LEFT (interlude)', 'mixtapes-and-eps/tbh/06-left/audio.wav'),
  ('tbh', 7, '07-was-wrong', 'Was Wrong', 'Was Wrong', 'mixtapes-and-eps/tbh/07-was-wrong/audio.wav'),
  ('tbh', 8, '08-2late', '2Late?', '2Late?', 'mixtapes-and-eps/tbh/08-2late/audio.wav'),
  ('tbh', 9, '09-artificial', 'ArTiFiCiAL', 'ArTiFiCiAL', 'mixtapes-and-eps/tbh/09-artificial/audio.wav')
on conflict (album_slug, slug) do update set
  track_number = excluded.track_number,
  title = excluded.title,
  display_title = excluded.display_title,
  storage_path = excluded.storage_path,
  updated_at = now();
