-- Server-only Twitch user authorization. Tokens are encrypted by the app with
-- AES-256-GCM before storage and are never readable through client RLS.
create table if not exists public.twitch_user_authorizations (
  id text primary key check (id = 'primary'),
  broadcaster_id text not null,
  broadcaster_login text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  authorized_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.twitch_user_authorizations enable row level security;
revoke all on table public.twitch_user_authorizations from anon, authenticated;
grant all on table public.twitch_user_authorizations to service_role;

comment on table public.twitch_user_authorizations is
  'Server-only encrypted Twitch OAuth authority for direct live publishing.';
