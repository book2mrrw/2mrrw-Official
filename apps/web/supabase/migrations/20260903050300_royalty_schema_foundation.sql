-- Royalty/collaborator-accounting schema foundation. No royalty or
-- collaborator accounting structure existed anywhere in this codebase before
-- this migration (the only prior "collaborator" reference was a free-text
-- display label in release liner-notes metadata, with no identity or split
-- semantics) — this is a from-scratch design, schema only. Payout computation
-- and a splits-sum-to-100 guard are intentionally deferred to a later slice;
-- adding a percentage cross-row constraint now, before any UI writes to this
-- table, would be speculative.

create table if not exists public.collaborators (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  email      text,
  user_id    uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_collaborators (
  id              uuid        primary key default gen_random_uuid(),
  release_id      uuid        references public.releases(id) on delete cascade,
  product_id      uuid        references public.products(id) on delete cascade,
  collaborator_id uuid        not null references public.collaborators(id) on delete cascade,
  role            text,
  split_percent   numeric(5,2) not null check (split_percent >= 0 and split_percent <= 100),
  created_at      timestamptz not null default now(),
  constraint release_collaborators_has_target check (release_id is not null or product_id is not null)
);

create index if not exists release_collaborators_release_id_idx on public.release_collaborators (release_id);
create index if not exists release_collaborators_product_id_idx on public.release_collaborators (product_id);
create index if not exists release_collaborators_collaborator_id_idx on public.release_collaborators (collaborator_id);

comment on table public.collaborators is
  'A person with a revenue split on one or more releases. Schema foundation only — no payout computation or UI wiring yet.';
comment on table public.release_collaborators is
  'Per-release/product split assignment. split_percent is not constrained to sum to 100 across a release''s rows — that validation belongs at the application layer once this table has a write path.';
