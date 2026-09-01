-- Store first-login location context on the base user profile.

alter table public.profiles
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text;

create index if not exists profiles_location_lookup_idx
  on public.profiles (lower(country), lower(state), lower(city))
  where city is not null and state is not null;
