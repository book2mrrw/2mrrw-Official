-- Allow gift redemptions to appear in library_items as source = 'gift'.

alter table public.library_items
  drop constraint if exists library_items_source_check;

alter table public.library_items
  add constraint library_items_source_check
  check (source in ('purchase', 'grant', 'bundle', 'gift'));
