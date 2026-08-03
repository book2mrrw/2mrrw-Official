-- Production Circle community system: persistent posts, replies, reactions, moderation, and realtime.

create table if not exists public.circle_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null default 'Fan',
  badge text,
  category text not null default 'thought' check (category in ('thought', 'question', 'release', 'live', 'visuals', 'creator update')),
  content text not null check (char_length(content) between 1 and 2000),
  gif_url text,
  is_creator boolean not null default false,
  is_pinned boolean not null default false,
  is_featured boolean not null default false,
  moderation_state text not null default 'approved' check (moderation_state in ('pending', 'approved', 'hidden', 'rejected')),
  subscriber_snapshot boolean not null default false,
  collector_snapshot boolean not null default false,
  inner_circle_snapshot boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.circle_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.circle_posts (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null default 'Fan',
  badge text,
  content text not null check (char_length(content) between 1 and 1200),
  is_creator boolean not null default false,
  is_featured boolean not null default false,
  moderation_state text not null default 'approved' check (moderation_state in ('pending', 'approved', 'hidden', 'rejected')),
  subscriber_snapshot boolean not null default false,
  collector_snapshot boolean not null default false,
  inner_circle_snapshot boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.circle_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.circle_posts (id) on delete cascade,
  reply_id uuid references public.circle_replies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reaction_key text not null check (reaction_key in ('felt', 'repeat', 'need')),
  subscriber_snapshot boolean not null default false,
  collector_snapshot boolean not null default false,
  inner_circle_snapshot boolean not null default false,
  created_at timestamptz not null default now(),
  constraint circle_reactions_single_target check (
    (post_id is not null and reply_id is null) or
    (post_id is null and reply_id is not null)
  )
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  section_key text not null check (section_key in ('blog', 'vision', 'innercircle', 'live')),
  item_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null default 'Fan',
  badge text,
  content text not null check (char_length(content) between 1 and 1200),
  is_creator boolean not null default false,
  is_featured boolean not null default false,
  moderation_state text not null default 'approved' check (moderation_state in ('pending', 'approved', 'hidden', 'rejected')),
  subscriber_snapshot boolean not null default false,
  collector_snapshot boolean not null default false,
  inner_circle_snapshot boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists circle_posts_feed_idx
  on public.circle_posts (is_pinned desc, created_at desc)
  where moderation_state = 'approved';

create index if not exists circle_posts_user_idx on public.circle_posts (user_id, created_at desc);
create index if not exists circle_replies_post_idx on public.circle_replies (post_id, created_at asc);
create index if not exists circle_reactions_post_idx on public.circle_reactions (post_id, reaction_key);
create index if not exists circle_reactions_reply_idx on public.circle_reactions (reply_id, reaction_key);
create index if not exists community_comments_item_idx on public.community_comments (section_key, item_id, created_at asc)
  where moderation_state = 'approved';
create index if not exists community_comments_user_idx on public.community_comments (user_id, created_at desc);

create unique index if not exists circle_reactions_unique_post
  on public.circle_reactions (post_id, user_id, reaction_key)
  where post_id is not null;

create unique index if not exists circle_reactions_unique_reply
  on public.circle_reactions (reply_id, user_id, reaction_key)
  where reply_id is not null;

drop trigger if exists set_circle_posts_updated_at on public.circle_posts;
create trigger set_circle_posts_updated_at
  before update on public.circle_posts
  for each row execute function public.set_updated_at();

drop trigger if exists set_circle_replies_updated_at on public.circle_replies;
create trigger set_circle_replies_updated_at
  before update on public.circle_replies
  for each row execute function public.set_updated_at();

drop trigger if exists set_community_comments_updated_at on public.community_comments;
create trigger set_community_comments_updated_at
  before update on public.community_comments
  for each row execute function public.set_updated_at();

alter table public.circle_posts enable row level security;
alter table public.circle_replies enable row level security;
alter table public.circle_reactions enable row level security;
alter table public.community_comments enable row level security;

drop policy if exists "circle_posts_select_approved_or_own" on public.circle_posts;
create policy "circle_posts_select_approved_or_own"
  on public.circle_posts for select
  using (moderation_state = 'approved' or auth.uid() = user_id);

drop policy if exists "circle_replies_select_approved_or_own" on public.circle_replies;
create policy "circle_replies_select_approved_or_own"
  on public.circle_replies for select
  using (moderation_state = 'approved' or auth.uid() = user_id);

drop policy if exists "circle_reactions_select_all" on public.circle_reactions;
create policy "circle_reactions_select_all"
  on public.circle_reactions for select
  using (true);

drop policy if exists "community_comments_select_approved_or_own" on public.community_comments;
create policy "community_comments_select_approved_or_own"
  on public.community_comments for select
  using (moderation_state = 'approved' or auth.uid() = user_id);

-- Writes go through server APIs with service role so moderation, identity snapshots,
-- and rate limits cannot be bypassed from browser clients.

do $$
begin
  alter publication supabase_realtime add table public.circle_posts;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.circle_replies;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.circle_reactions;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.community_comments;
exception
  when duplicate_object then null;
end $$;
