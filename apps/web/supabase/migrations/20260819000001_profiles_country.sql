alter table public.profiles
  add column if not exists country text;

create index if not exists profiles_country_idx
  on public.profiles (country)
  where country is not null;
