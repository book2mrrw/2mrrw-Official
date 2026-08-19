-- Add gender and age_range to profiles for audience analytics.
-- city/state/country already exist from 20260517014500_profile_location_fields.sql.

alter table public.profiles
  add column if not exists gender text check (gender in ('male', 'female')),
  add column if not exists age_range text check (age_range in ('18-25', '25-40', '40-65'));

create index if not exists profiles_demographics_idx
  on public.profiles (gender, age_range)
  where gender is not null and age_range is not null;
