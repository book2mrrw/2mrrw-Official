-- Adds 'short_film' ("Short Filmz" — display-label-only branding, same
-- convention as 'music_video' / "Audio Visualz") as an 8th video_type
-- value: short-form narrative content, distinct from feature-length
-- 'movie'. Same dynamic drop-and-recreate pattern Slice 13 used for this
-- exact constraint, since we're widening a constraint we ourselves created
-- (not guessing at an unknown pre-existing name).
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

alter table public.audio_visuals
  add constraint audio_visuals_video_type_check
  check (video_type in ('music_video', 'podcast', 'interview', 'movie', 'documentary', 'vlog', 'concert', 'short_film'));
