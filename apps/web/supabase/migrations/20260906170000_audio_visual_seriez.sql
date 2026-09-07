-- Slice 14 — "Seriez" (spelled with a z, always) episodic container.
--
-- Seriez is NOT a content-genre value on audio_visuals.video_type — it's an
-- orthogonal structural attachment any of the 7 real genres can optionally
-- carry (a podcast can be standalone or part of a Seriez; same for a
-- documentary, movie anthology, etc.). This mirrors how is_2mrrw_original
-- works: a badge/attribute layered on top of a genre, never a genre itself.
-- video_type is deliberately left untouched by this migration.
--
-- An episode of a Seriez IS an ordinary audio_visuals row (season_number +
-- episode_number set, seriez_id pointing at its container) — this reuses
-- 100% of the existing asset-version/rendition/entitlement/purchase/playback
-- machinery for free, rather than building a second, parallel video
-- pipeline just for episodes.
create table if not exists public.audio_visual_seriez (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  description           text,
  credits               jsonb not null default '[]',
  cast_members          jsonb not null default '[]',
  poster_r2_key         text,
  metadata              jsonb not null default '{}',  -- animated_cover_r2_key, same convention as audio_visuals.metadata
  is_2mrrw_original     boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.audio_visual_seriez is
  'A lightweight, standalone container ("just set up a theme") that episodes attach to later — creating one with zero episodes is a normal, supported state, not a special case.';

comment on column public.audio_visual_seriez.metadata is
  'Holds animated_cover_r2_key — same convention as audio_visuals.metadata, isolated the same way (never touches release/track/audio code).';

-- Season-level metadata beyond a plain number (its own cover art, its own
-- description) is a deliberately deferred scope decision, not a silent gap —
-- season_number is just an integer on the episode row below.
alter table public.audio_visuals
  add column if not exists seriez_id uuid references public.audio_visual_seriez(id) on delete set null,
  add column if not exists season_number integer check (season_number is null or season_number > 0),
  add column if not exists episode_number integer check (episode_number is null or episode_number > 0);

comment on column public.audio_visuals.seriez_id is
  'Optional attachment to a Seriez container. Null means this content stands alone — the same video_type (podcast, documentary, movie, etc.) is valid either way.';

-- A plain (non-partial) unique constraint is correct here: SQL treats each
-- NULL as distinct from every other NULL, so any number of standalone rows
-- (seriez_id null) coexist freely, while two real episodes of the same
-- Seriez can never claim the same season+episode number.
alter table public.audio_visuals
  add constraint audio_visuals_seriez_episode_unique
  unique (seriez_id, season_number, episode_number);

create index if not exists idx_audio_visuals_seriez on public.audio_visuals(seriez_id);

-- Genre classification for a Seriez itself (its own container-level genre,
-- independent of any individual episode's genre) — same mirrored shape as
-- audio_visual_genre_classifications and release_genre_classifications,
-- pointing at the same genre_taxonomy lookup.
create table if not exists public.audio_visual_seriez_genre_classifications (
  seriez_id   uuid not null references public.audio_visual_seriez(id) on delete cascade,
  taxonomy_id uuid not null references public.genre_taxonomy(id) on delete restrict,
  role        text not null check (role in ('primary', 'subgenre', 'secondary')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (seriez_id, taxonomy_id)
);

create unique index if not exists audio_visual_seriez_genre_classifications_one_primary
  on public.audio_visual_seriez_genre_classifications (seriez_id)
  where role = 'primary';

create index if not exists idx_audio_visual_seriez_genre_classifications_taxonomy
  on public.audio_visual_seriez_genre_classifications (taxonomy_id);

-- RLS: service_role only for the container itself (matching audio_visuals'
-- own no_public_access policy — a draft/unpublished Seriez shell should be
-- exactly as invisible as a draft audio_visuals row), but genre
-- classifications stay public-readable like every other genre join table.
alter table public.audio_visual_seriez enable row level security;
alter table public.audio_visual_seriez_genre_classifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'audio_visual_seriez' and policyname = 'no_public_access') then
    create policy no_public_access on public.audio_visual_seriez for all to public using (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audio_visual_seriez_genre_classifications' and policyname = 'public_read') then
    create policy public_read on public.audio_visual_seriez_genre_classifications for select to public using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audio_visual_seriez_genre_classifications' and policyname = 'no_public_write') then
    create policy no_public_write on public.audio_visual_seriez_genre_classifications for insert to public with check (false);
  end if;
end $$;
