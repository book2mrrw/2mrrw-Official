alter table public.releases
  add column if not exists content_kind text not null default 'music'
    check (content_kind in ('music', 'podcast'));

alter table public.products
  add column if not exists content_kind text not null default 'music'
    check (content_kind in ('music', 'podcast'));
