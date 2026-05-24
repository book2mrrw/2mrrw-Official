-- Extend gifts.item_type CHECK for storefront product types (feature, merch, bundle, vinyl).

alter table public.gifts
  drop constraint if exists gifts_item_type_check;

alter table public.gifts
  add constraint gifts_item_type_check
  check (
    item_type in (
      'single',
      'ep',
      'album',
      'deluxe',
      'collector_card',
      'feature',
      'merch',
      'bundle',
      'vinyl'
    )
  );
