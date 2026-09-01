-- Unified Vault content, entitlement, and playback persistence.

create table if not exists public.vault_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entitlement_type text not null check (entitlement_type in ('inner_circle', 'vault_pass')),
  access_tier text not null check (access_tier in ('inner_circle', 'vault_pass')),
  source_type text not null check (source_type in ('subscription', 'collector_ownership', 'purchase', 'manual')),
  source_id text not null,
  status text not null default 'active' check (status in ('active', 'past_due', 'expired', 'revoked', 'refunded')),
  renewal_state text not null default 'none' check (renewal_state in ('none', 'trialing', 'active', 'retrying', 'canceled')),
  purchase_id uuid references public.purchases (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  collector_ownership_id uuid references public.collector_ownerships (id) on delete set null,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement_type, source_type, source_id)
);

create index if not exists vault_entitlements_user_idx
  on public.vault_entitlements (user_id, access_tier, status);

create index if not exists vault_entitlements_active_idx
  on public.vault_entitlements (access_tier, status, starts_at, ends_at)
  where status = 'active';

create table if not exists public.vault_content (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category text not null,
  title text not null,
  description text not null default '',
  access_tier text not null default 'public' check (access_tier in ('public', 'inner_circle', 'vault_pass')),
  media_type text not null default 'text' check (media_type in ('audio', 'video', 'image', 'text', 'mixed', 'schedule', 'archive', 'commentary')),
  atmosphere text,
  behavior text,
  cover_url text,
  preview_storage_path text,
  media_storage_path text,
  duration_seconds integer,
  sort_order integer not null default 100,
  featured boolean not null default false,
  visibility text not null default 'draft' check (visibility in ('draft', 'scheduled', 'published', 'archived')),
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vault_content_visibility_idx
  on public.vault_content (visibility, access_tier, sort_order);

create index if not exists vault_content_category_idx
  on public.vault_content (category, sort_order);

create table if not exists public.vault_content_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content_id uuid not null references public.vault_content (id) on delete cascade,
  position_seconds integer not null default 0,
  completed boolean not null default false,
  last_played_at timestamptz not null default now(),
  device_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, content_id)
);

create index if not exists vault_content_progress_user_idx
  on public.vault_content_progress (user_id, last_played_at desc);

insert into public.products (slug, title, product_type, price_cents, cover_url, metadata, active)
values (
  'vault-pass',
  'Vault Pass',
  'vault',
  7000,
  '/images/albums/lovehz.jpg',
  '{"access_tier":"vault_pass","one_time":true,"description":"Full premium Vault archive access"}'::jsonb,
  true
)
on conflict (slug) do update
set title = excluded.title,
    product_type = excluded.product_type,
    price_cents = excluded.price_cents,
    cover_url = excluded.cover_url,
    metadata = public.products.metadata || excluded.metadata,
    active = true;

insert into public.vault_content (slug, category, title, description, access_tier, media_type, atmosphere, behavior, cover_url, sort_order, featured, visibility, published_at, metadata)
values
  ('audio-diaries-private-frequency-notes','Audio Diaries','Private Frequency Notes','Intimate voice-led reflections, emotional context, and diary-like fragments that set the tone for the wider Vault.','inner_circle','audio','Intimate · Reflective · Emotional','audio','/images/albums/lovehz.jpg',10,true,'published',now(),'{"seed":true}'::jsonb),
  ('exclusive-interviews-long-form-room','Exclusive Interviews','The Long Form Room','Documentary-style conversations, creative breakdowns, and artist commentary that sit deeper than a normal post or video embed.','vault_pass','video','Documentary · Premium · Intentional','video','/images/albums/ad.jpg',20,true,'published',now(),'{"seed":true}'::jsonb),
  ('bts-behind-the-world','BTS','Behind The World','Quiet footage, studio context, and observational moments around the work without turning the Vault into a noisy video feed.','inner_circle','video','Cinematic · Immersive · Observational','video','/images/singles/hourglass.jpg',30,true,'published',now(),'{"seed":true}'::jsonb),
  ('creative-process-sessions-notes','Creative Process','Sessions, Notes, and Breakdowns','Studio fragments, production notes, recording context, and the thinking behind songs before they become finished releases.','inner_circle','mixed','Process-led · Personal · Detailed','mixed','/images/albums/lovehz.jpg',40,false,'published',now(),'{"seed":true}'::jsonb),
  ('archives-lost-ideas','Archives','Lost Ideas and Early Signals','Alternate covers, early concepts, prototype releases, demo-era memories, and artifacts from earlier versions of the world.','inner_circle','archive','Historical · Collectible · Emotional','archive','/images/albums/tbh.jpg',50,false,'published',now(),'{"seed":true}'::jsonb),
  ('unreleased-archives-hidden-shelf','Unreleased Archives','The Hidden Shelf','Demos, sketches, archive cuts, and unreleased works held back for the right moment.','vault_pass','archive','Mysterious · Rare · Collectible','archive','/images/albums/ad.jpg',60,false,'published',now(),'{"seed":true}'::jsonb),
  ('premium-replays-archive','Premium Livestream Replays','Replay Archive','Twitch-powered replay windows and premium live moments preserved inside the 2MRRW ecosystem.','inner_circle','video','Live · Premium · Time-bound','video','/images/albums/lovehz.jpg',70,false,'published',now(),'{"seed":true}'::jsonb),
  ('director-commentary-frame-by-frame','Director Commentary','Frame By Frame','Track-by-track and visual-by-visual creative narration from 2MRRW.','vault_pass','commentary','Analytical · Artistic · Explanatory','commentary','/images/singles/w2d.jpg',80,false,'published',now(),'{"seed":true}'::jsonb),
  ('studio-sessions-room-takes','Studio Sessions','The Room Takes','Recording energy, session notes, and process-first glimpses from the room where the records take shape.','vault_pass','video','Raw · Present · Immersive','video','/images/singles/artificial.jpg',90,false,'published',now(),'{"seed":true}'::jsonb),
  ('visual-concepts-look-before','Visual Concepts','The Look Before The Look','Moodboards, alternate cover directions, cinematic references, and early visual worldbuilding.','vault_pass','image','Atmospheric · Conceptual · Artistic','image','/images/albums/ad.jpg',100,false,'published',now(),'{"seed":true}'::jsonb),
  ('vault-notes-archive-margins','Vault Notes','Archive Margins','Short written entries from the archive as the world evolves.','public','text','Minimal · Written · Contextual','text','/images/albums/tbh.jpg',110,false,'published',now(),'{"seed":true}'::jsonb),
  ('future-drops-signal-board','Future Drops','Signal Board','A calm signal board for upcoming archive unlocks, collector moments, and premium Vault additions.','public','schedule','Anticipatory · Curated · Scarce','schedule','/images/albums/lovehz.jpg',120,false,'published',now(),'{"seed":true}'::jsonb)
on conflict (slug) do update
set category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    access_tier = excluded.access_tier,
    media_type = excluded.media_type,
    atmosphere = excluded.atmosphere,
    behavior = excluded.behavior,
    cover_url = excluded.cover_url,
    sort_order = excluded.sort_order,
    featured = excluded.featured,
    visibility = excluded.visibility,
    published_at = excluded.published_at,
    metadata = public.vault_content.metadata || excluded.metadata;

drop trigger if exists vault_entitlements_updated_at on public.vault_entitlements;
create trigger vault_entitlements_updated_at
  before update on public.vault_entitlements
  for each row execute function public.set_updated_at();

drop trigger if exists vault_content_updated_at on public.vault_content;
create trigger vault_content_updated_at
  before update on public.vault_content
  for each row execute function public.set_updated_at();

drop trigger if exists vault_content_progress_updated_at on public.vault_content_progress;
create trigger vault_content_progress_updated_at
  before update on public.vault_content_progress
  for each row execute function public.set_updated_at();

alter table public.vault_entitlements enable row level security;
alter table public.vault_content enable row level security;
alter table public.vault_content_progress enable row level security;

drop policy if exists "vault_entitlements_select_own" on public.vault_entitlements;
create policy "vault_entitlements_select_own"
  on public.vault_entitlements for select
  using (auth.uid() = user_id);

drop policy if exists "vault_content_select_published" on public.vault_content;
create policy "vault_content_select_published"
  on public.vault_content for select
  using (visibility = 'published');

drop policy if exists "vault_content_progress_select_own" on public.vault_content_progress;
create policy "vault_content_progress_select_own"
  on public.vault_content_progress for select
  using (auth.uid() = user_id);

drop policy if exists "vault_content_progress_insert_own" on public.vault_content_progress;
create policy "vault_content_progress_insert_own"
  on public.vault_content_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "vault_content_progress_update_own" on public.vault_content_progress;
create policy "vault_content_progress_update_own"
  on public.vault_content_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vault_content'
  ) then
    alter publication supabase_realtime add table public.vault_content;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vault_entitlements'
  ) then
    alter publication supabase_realtime add table public.vault_entitlements;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vault_content_progress'
  ) then
    alter publication supabase_realtime add table public.vault_content_progress;
  end if;
end $$;
