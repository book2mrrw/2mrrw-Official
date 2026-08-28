-- HLS rendition contract v2
-- Additive and backward-compatible: legacy manifests continue to resolve through
-- the existing bitrate/count fields while newly transcoded assets publish exact
-- segment timing and measured codec/bandwidth metadata.

alter table public.hls_manifests
  add column if not exists media_kind text not null default 'audio',
  add column if not exists segment_durations jsonb not null default '{}'::jsonb,
  add column if not exists rendition_metadata jsonb not null default '{}'::jsonb,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists transcode_profile_version integer not null default 1;

update public.hls_manifests
   set media_kind = 'video'
 where release_type = 'vault'
   and bitrates && array['4000k', '2000k', '1000k', '720k']::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_manifests'::regclass
       and conname = 'hls_manifests_media_kind_check'
  ) then
    alter table public.hls_manifests
      add constraint hls_manifests_media_kind_check
      check (media_kind in ('audio', 'video'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_manifests'::regclass
       and conname = 'hls_manifests_segment_durations_object_check'
  ) then
    alter table public.hls_manifests
      add constraint hls_manifests_segment_durations_object_check
      check (jsonb_typeof(segment_durations) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_manifests'::regclass
       and conname = 'hls_manifests_rendition_metadata_object_check'
  ) then
    alter table public.hls_manifests
      add constraint hls_manifests_rendition_metadata_object_check
      check (jsonb_typeof(rendition_metadata) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_manifests'::regclass
       and conname = 'hls_manifests_source_metadata_object_check'
  ) then
    alter table public.hls_manifests
      add constraint hls_manifests_source_metadata_object_check
      check (jsonb_typeof(source_metadata) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_manifests'::regclass
       and conname = 'hls_manifests_transcode_profile_version_check'
  ) then
    alter table public.hls_manifests
      add constraint hls_manifests_transcode_profile_version_check
      check (transcode_profile_version >= 1);
  end if;
end
$$;

comment on column public.hls_manifests.media_kind is
  'Authoritative encoded media family: audio or video.';
comment on column public.hls_manifests.segment_durations is
  'Exact FFmpeg EXTINF duration arrays keyed by rendition label.';
comment on column public.hls_manifests.rendition_metadata is
  'Measured width, height, frame rate, codecs, bandwidth, and byte totals keyed by rendition label.';
comment on column public.hls_manifests.source_metadata is
  'Sanitized ffprobe facts used to derive the output ladder; contains no object credentials.';
comment on column public.hls_manifests.transcode_profile_version is
  'Monotonic encoding-contract version. Version 2 is the source-aware video ladder.';
