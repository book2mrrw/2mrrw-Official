-- Slice 13 — Audio Visualz content-type taxonomy: a real CHECK constraint on
-- video_type (there was none before — just a descriptive comment) covering
-- music_video/podcast/interview/movie/documentary/vlog/concert, shared
-- metadata columns every content type needs (including the is_2mrrw_original
-- studio badge, orthogonal to type), and a genre classification join table
-- reusing the SAME genre_taxonomy lookup releases already use (no duplicate
-- taxonomy data). public.audio_visuals has zero rows in production as of
-- this migration (confirmed live), so no backfill/data-migration concerns
-- apply here.
--
-- "Audio Visualz" (the platform's branded name for what this column calls
-- 'music_video') is a DISPLAY LABEL ONLY, decided deliberately — every
-- Slice 7-12 file already reads/writes the literal 'music_video' value
-- (rendition-planner.js, its tests, etc.), and renaming it here would touch
-- working, tested code for a purely cosmetic reason. The mapping from
-- 'music_video' -> "Audio Visualz" belongs in the frontend only.
do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.audio_visuals'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%video_type%';
  if con_name is not null then
    execute format('alter table public.audio_visuals drop constraint %I', con_name);
  end if;
end $$;

-- 'concert' here is a filmed/recorded concert VIDEO, an on-demand Audio
-- Visualz content type — distinct from public.shows_events, which is
-- ticket sales for an upcoming live, in-person event. The two never
-- reference each other; a past ticketed show and its filmed recording
-- (if one exists) are unrelated rows in unrelated tables today.
alter table public.audio_visuals
  add constraint audio_visuals_video_type_check
  check (video_type in ('music_video', 'podcast', 'interview', 'movie', 'documentary', 'vlog', 'concert'));

-- Shared metadata every content type carries. credits/cast_members are jsonb
-- arrays (e.g. [{"role": "Director", "name": "..."}]) rather than a
-- normalized people table — the simplest reversible option given no existing
-- precedent for this in either the release or audio_visual schema; usage is
-- type-dependent by admin-UI convention, not enforced here (cast_members is
-- meaningful for movie/documentary/scripted content, meaningless for a
-- straight podcast episode, but nothing stops any type from setting it).
alter table public.audio_visuals
  add column if not exists credits jsonb not null default '[]',
  add column if not exists cast_members jsonb not null default '[]',
  add column if not exists scheduled_at timestamptz,
  add column if not exists duration_seconds numeric,
  add column if not exists metadata jsonb not null default '{}',
  add column if not exists is_2mrrw_original boolean not null default false;

comment on column public.audio_visuals.metadata is
  'Holds animated_cover_r2_key (the motion/animated cover video) — deliberately mirroring releases.metadata''s own key name and shape, but as a fully separate column on a fully separate table. Never read/written by any release/track/audio code path, and this table must never be either.';

comment on column public.audio_visuals.is_2mrrw_original is
  '"2MRRW Originals" is a studio-provenance BADGE (content produced by 2MRRW Studios), never a content type — orthogonal to video_type, exactly like the Seriez attachment. Any video_type can be a 2MRRW Original or not.';

comment on column public.audio_visuals.scheduled_at is
  'A future publish time the admin sets intentionally. Distinct from publication_state''s draft/processing/ready/published workflow, which tracks encoding-pipeline progress, not calendar scheduling.';

-- Genre classification, reusing genre_taxonomy directly (same table
-- releases.genre picks from) via a new join table shaped identically to
-- release_genre_classifications — same role semantics, same one-primary-only
-- rule, just keyed to audio_visual_id instead of release_id.
create table if not exists public.audio_visual_genre_classifications (
  audio_visual_id uuid not null references public.audio_visuals(id) on delete cascade,
  taxonomy_id     uuid not null references public.genre_taxonomy(id) on delete restrict,
  role            text not null check (role in ('primary', 'subgenre', 'secondary')),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  primary key (audio_visual_id, taxonomy_id)
);

create unique index if not exists audio_visual_genre_classifications_one_primary
  on public.audio_visual_genre_classifications (audio_visual_id)
  where role = 'primary';

create index if not exists idx_audio_visual_genre_classifications_taxonomy
  on public.audio_visual_genre_classifications (taxonomy_id);

alter table public.audio_visual_genre_classifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'audio_visual_genre_classifications' and policyname = 'public_read'
  ) then
    create policy public_read on public.audio_visual_genre_classifications for select to public using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'audio_visual_genre_classifications' and policyname = 'no_public_write'
  ) then
    create policy no_public_write on public.audio_visual_genre_classifications
      for insert to public with check (false);
  end if;
end $$;
