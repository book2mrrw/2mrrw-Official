-- Repair profiles for passwordless guest identity.
-- Run this in Supabase SQL Editor if guest entry fails with:
--   "Database error creating new user"
-- or if profiles is missing full_name / phone columns.

alter table public.profiles
  add column if not exists full_name text not null default '',
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profiles_email_phone_unique_idx
  on public.profiles (lower(email), phone)
  where email is not null and phone is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'contact_email', new.email),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = coalesce(excluded.email, public.profiles.email),
    phone = coalesce(excluded.phone, public.profiles.phone),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
