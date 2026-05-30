-- Patch: ensure product media columns are entity folders only (no filenames).
-- Complements 20260529130000_entity_folder_paths.sql.

alter table public.products
  add column if not exists release_date date,
  add column if not exists display_title text,
  add column if not exists artwork_path text,
  add column if not exists video_path text,
  add column if not exists album_slug text;

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
set video_path = public.strip_media_filename(video_path) || '/'
where video_path is not null
  and video_path ~* '\.(mp4|webm|mov)$';

update public.products
set artwork_path = public.strip_media_filename(artwork_path) || '/'
where artwork_path is not null
  and artwork_path ~* '\.(jpg|jpeg|png|webp)$';

update public.products
set preview_path = public.strip_media_filename(preview_path) || '/'
where preview_path is not null
  and preview_path ~* '\.(wav|flac|m4a|mp3)$';

update public.products
set storage_path = public.strip_media_filename(storage_path) || '/'
where storage_path is not null
  and storage_path ~* '\.(wav|flac|m4a|mp3)$';

-- Prefix-relative paths missing domain roots → canonical folders
update public.products set
  storage_path = 'singles/' || slug || '/',
  preview_path = 'previews/singles/' || slug || '/',
  artwork_path = 'images/singles/' || slug || '/',
  video_path = 'videos/singles/' || slug || '/'
where product_type in ('single', 'feature')
  and slug is not null
  and (
    storage_path is null
    or storage_path !~* '^(digital-assets/)?(singles|features)/'
  );

drop function if exists public.strip_media_filename(text);
