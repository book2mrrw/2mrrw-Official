-- Canonical Audio Visual schema v2 — the foundation for the first-party
-- video platform. Codec-generic and long-form-aware from the start (music
-- videos through 4-hour documentaries/podcasts; no duration assumption baked
-- into any column). videoId/assetVersionId are the only identity ever used
-- for signed tokens or entitlement checks — release_id/track_id link by
-- stable UUID, never by slug (an explicit improvement over the only prior
-- precedent, release_visual_assets, which is slug-keyed).
--
-- audio_visuals and audio_visual_asset_versions reference each other
-- (current_version_id / audio_visual_id), so audio_visuals.current_version_id
-- is created as a plain column first and the FK is added once both tables
-- exist — this is the standard, safe way to express a circular reference.

create table if not exists public.audio_visuals (
  id                    uuid primary key default gen_random_uuid(),  -- stable videoId
  release_id            uuid references public.releases(id),
  track_id              uuid references public.tracks(id),           -- null for a release-level (non-track-specific) video
  title                 text not null,
  description           text,
  video_type            text not null default 'music_video',         -- music_video | documentary | podcast | other
  price_cents           integer not null check (price_cents >= 0),
  poster_r2_key         text,
  thumbnail_r2_key      text,
  peek_start_seconds    numeric not null default 0,
  peek_duration_seconds numeric not null default 8 check (peek_duration_seconds between 5 and 12),
  current_version_id    uuid,  -- FK added below, once audio_visual_asset_versions exists
  publication_state     text not null default 'draft'
    check (publication_state in ('draft','processing','ready','published','failed','unpublished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audio_visual_asset_versions (
  id                     uuid primary key default gen_random_uuid(),  -- assetVersionId
  audio_visual_id        uuid not null references public.audio_visuals(id) on delete cascade,
  master_r2_key          text not null,
  source_analysis        jsonb,      -- SourceAnalyzer probe: container/codec/profile/level/dimensions/DAR/PAR/
                                      -- frame_rate/frame_rate_mode/duration/bit_depth/pixel_format/chroma/
                                      -- color_primaries/transfer/matrix/color_range/hdr_signaling/mastering
                                      -- metadata/MaxCLL/MaxFALL/rotation/audio_codec/audio_channels
  complexity_analysis    jsonb,      -- SceneComplexityAnalyzer output: scene_cut_rate, signalstats, interlace, cropdetect
  quality_policy_version text,       -- which RenditionPlanner/encoder-settings policy produced this version
  hdr_mode               text check (hdr_mode in ('sdr','hdr10','hlg') or hdr_mode is null),
  peek_r2_key            text,
  is_immediate_playable  boolean not null default false,  -- true only if the master itself is browser-safe MP4/H.264/AAC
  status                 text not null default 'uploaded'
    check (status in ('uploaded','probing','qc_failed','analyzing','planning','encoding',
                       'evaluating_quality','packaging','validating','ready','failed')),
  storage_preflight      jsonb,      -- {requiredScratchBytes, availableScratchBytes, safetyReserveBytes, verdict}
  created_at             timestamptz not null default now(),
  promoted_at            timestamptz
);

alter table public.audio_visuals
  add constraint audio_visuals_current_version_id_fkey
  foreign key (current_version_id) references public.audio_visual_asset_versions(id);

create index if not exists idx_audio_visuals_release on public.audio_visuals(release_id);
create index if not exists idx_audio_visuals_track on public.audio_visuals(track_id);
create index if not exists idx_audio_visual_asset_versions_audio_visual on public.audio_visual_asset_versions(audio_visual_id);

-- Codec-generic rendition ledger — adding a future codec never requires
-- remodeling media identity.
create table if not exists public.audio_visual_renditions (
  id                 uuid primary key default gen_random_uuid(),
  asset_version_id   uuid not null references public.audio_visual_asset_versions(id) on delete cascade,
  codec_family       text not null check (codec_family in ('avc','av1')),
  resolution_label   text not null,   -- '2160p' | '1440p' | '1080p' | '720p' | '480p'
  bit_depth          integer not null default 8 check (bit_depth in (8, 10)),
  hdr_mode           text not null default 'sdr' check (hdr_mode in ('sdr','hdr10','hlg')),
  hls_prefix         text not null,   -- CMAF/fMP4 segment prefix in R2
  vmaf_score         numeric,
  cambi_score        numeric,
  ssim_score         numeric,
  encode_settings_id text,            -- ties back to quality_policy_version for reproducibility
  created_at         timestamptz not null default now(),
  unique (asset_version_id, codec_family, resolution_label, hdr_mode)
);

-- Master (release audio) <-> video timeline handoff mapping. Keyed by exact
-- track_id (never slug) and exact video_asset_version_id — replacing either
-- the audio master or the video creates a new valid combination; an old
-- mapping never silently applies to a version it wasn't created against.
-- master_snapshot_at (a copy of tracks.updated_at at map-creation time) lets
-- playback-time code detect a stale mapping without needing a full audio
-- versioning system (none exists today — audio_master_revisions was never
-- deployed, confirmed dead).
create table if not exists public.audio_visual_sync_maps (
  id                     uuid primary key default gen_random_uuid(),
  audio_visual_id        uuid not null references public.audio_visuals(id) on delete cascade,
  track_id               uuid not null references public.tracks(id),
  video_asset_version_id uuid not null references public.audio_visual_asset_versions(id),
  mapping_type           text not null check (mapping_type in ('offset', 'segments')),
  offset_ms              integer,   -- used when mapping_type = 'offset'
  segments               jsonb,     -- used when mapping_type = 'segments': [{masterStartMs, masterEndMs, videoStartMs}, ...]
  sync_source            text not null default 'manual' check (sync_source in ('manual', 'auto_suggested', 'auto_confirmed')),
  master_snapshot_at     timestamptz not null,
  is_valid               boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  unique (audio_visual_id, track_id, video_asset_version_id)
);

create index if not exists idx_audio_visual_sync_maps_audio_visual on public.audio_visual_sync_maps(audio_visual_id);

-- RLS: service_role only, matching every other admin-managed media table in this project.
alter table public.audio_visuals ENABLE ROW LEVEL SECURITY;
alter table public.audio_visual_asset_versions ENABLE ROW LEVEL SECURITY;
alter table public.audio_visual_renditions ENABLE ROW LEVEL SECURITY;
alter table public.audio_visual_sync_maps ENABLE ROW LEVEL SECURITY;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'audio_visuals' and policyname = 'no_public_access') then
    create policy no_public_access on public.audio_visuals for all to public using (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audio_visual_asset_versions' and policyname = 'no_public_access') then
    create policy no_public_access on public.audio_visual_asset_versions for all to public using (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audio_visual_renditions' and policyname = 'no_public_access') then
    create policy no_public_access on public.audio_visual_renditions for all to public using (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audio_visual_sync_maps' and policyname = 'no_public_access') then
    create policy no_public_access on public.audio_visual_sync_maps for all to public using (false);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- purchase_items.item_type / entitlements.resource_type: expand to allow
-- 'audio_visual', without assuming the existing check constraint's name —
-- looked up dynamically so this is safe regardless of how it was originally
-- created. Both tables are live and actively used by every real purchase
-- today; this only ADDS a permitted value, every existing row/value stays
-- valid.
-- ---------------------------------------------------------------------------
do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.purchase_items'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%item_type%';
  if con_name is not null then
    execute format('alter table public.purchase_items drop constraint %I', con_name);
  end if;
end $$;

alter table public.purchase_items
  add constraint purchase_items_item_type_check
  check (item_type in ('digital', 'merch', 'audio_visual'));

do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.entitlements'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%resource_type%';
  if con_name is not null then
    execute format('alter table public.entitlements drop constraint %I', con_name);
  end if;
end $$;

alter table public.entitlements
  add constraint entitlements_resource_type_check
  check (resource_type in ('product', 'track', 'release', 'vault_collection', 'audio_visual'));
