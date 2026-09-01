-- Normalize media paths to entity folders (strip trailing filenames).
-- Idempotent: safe to re-run.

-- Ensure columns/tables from 20260529120000 exist before path updates.
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

comment on column public.products.storage_path is 'Entity folder under digital-assets/ (no filename).';
comment on column public.products.preview_path is 'Entity folder under previews/ (no filename).';
comment on column public.products.artwork_path is 'Entity folder under images/ (no filename).';
comment on column public.products.video_path is 'Entity folder under videos/ (no filename).';
comment on column public.catalog_tracks.storage_path is 'Entity folder under digital-assets/mixtapes-and-eps/ (no filename).';

-- Helper: strip known media extensions from path tail.
create or replace function public.strip_media_filename(path text)
returns text
language sql
immutable
as $$
  select case
    when path is null or path = '' then path
    when path ~* '\.(wav|flac|m4a|mp3|jpg|jpeg|png|webp|mp4|webm|mov)$'
      then regexp_replace(path, '/[^/]+\.(wav|flac|m4a|mp3|jpg|jpeg|png|webp|mp4|webm|mov)$', '', 'i')
    else regexp_replace(path, '/$', '')
  end;
$$;

-- ── SINGLES: folder-only paths ──────────────────────────────────────────────
update public.products set
  storage_path = 'singles/hour-glass/',
  preview_path = 'previews/singles/hour-glass/',
  artwork_path = 'images/singles/hour-glass/',
  video_path = 'videos/singles/hour-glass/'
where slug = 'hour-glass';

update public.products set
  storage_path = 'singles/w2d/',
  preview_path = 'previews/singles/w2d/',
  artwork_path = 'images/singles/w2d/',
  video_path = 'videos/singles/w2d/'
where slug = 'w2d';

update public.products set
  storage_path = 'singles/artificial/',
  preview_path = 'previews/singles/artificial/',
  artwork_path = 'images/singles/artificial/',
  video_path = 'videos/singles/artificial/'
where slug = 'artificial';

update public.products set
  storage_path = 'singles/turnt-me-2-dis/',
  preview_path = 'previews/singles/turnt-me-2-dis/',
  artwork_path = 'images/singles/turnt-me-2-dis/',
  video_path = 'videos/singles/turnt-me-2-dis/'
where slug = 'turnt-me-2-dis';

-- ── FEATURES ────────────────────────────────────────────────────────────────
update public.products set
  storage_path = 'features/i-dont-believe-you/',
  preview_path = 'previews/features/i-dont-believe-you/',
  artwork_path = 'images/features/i-dont-believe-you/'
where slug = 'i-dont-believe-you';

update public.products set
  storage_path = 'features/2-heavy/',
  preview_path = 'previews/features/2-heavy/',
  artwork_path = 'images/features/2-heavy/'
where slug = '2-heavy';

-- ── ALBUMS (artwork folder only) ────────────────────────────────────────────
update public.products set
  artwork_path = 'images/mixtapes-and-eps/love-hz-vol-1/'
where slug = 'love-hz-vol-1';

update public.products set
  artwork_path = 'images/mixtapes-and-eps/ad/'
where slug = 'ad';

update public.products set
  artwork_path = 'images/mixtapes-and-eps/tbh/'
where slug = 'tbh';

-- ── CATALOG TRACKS: strip audio.wav from storage_path ───────────────────────
update public.catalog_tracks
set storage_path = public.strip_media_filename(storage_path) || '/'
where storage_path is not null
  and storage_path ~* '\.(wav|flac|m4a|mp3)$';

-- Catch-all: normalize any remaining filename-based product paths.
update public.products
set storage_path = public.strip_media_filename(storage_path) || '/'
where storage_path is not null
  and storage_path ~* '\.(wav|flac|m4a|mp3)$';

update public.products
set preview_path = public.strip_media_filename(preview_path) || '/'
where preview_path is not null
  and preview_path ~* '\.(wav|flac|m4a|mp3)$';

update public.products
set artwork_path = public.strip_media_filename(artwork_path) || '/'
where artwork_path is not null
  and artwork_path ~* '\.(jpg|jpeg|png|webp)$';

update public.products
set video_path = public.strip_media_filename(video_path) || '/'
where video_path is not null
  and video_path ~* '\.(mp4|webm|mov)$';

drop function if exists public.strip_media_filename(text);
