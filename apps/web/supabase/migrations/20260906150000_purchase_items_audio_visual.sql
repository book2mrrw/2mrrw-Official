-- Audio Visual purchases have no products row and no slug (audio_visuals
-- is a stable-ID-only table — see 20260906120000_audio_visual_schema_v2.sql's
-- own header comment), but purchase_items.product_slug was `not null`,
-- confirmed via the World-Class Audio Visual Architecture Audit's P1
-- finding: recordPurchaseItems() (fulfill-purchase.js) filters line items
-- on `item?.slug`, which would silently DROP an Audio Visual line item
-- from purchase_items entirely (never inserted, not even under the wrong
-- item_type) rather than merely misrecording its type.
--
-- product_slug becomes nullable; a new nullable audio_visual_id column
-- parallels product_id for the ID-based case. Existing rows are untouched
-- (every existing row has a real product_slug already).
alter table public.purchase_items
  alter column product_slug drop not null;

alter table public.purchase_items
  add column if not exists audio_visual_id uuid references public.audio_visuals(id) on delete set null;

create index if not exists purchase_items_audio_visual_id_idx
  on public.purchase_items (audio_visual_id);

-- Expand item_type — this migration's own reason for existing.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.purchase_items'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%item_type%';

  if v_constraint_name is not null then
    execute format('alter table public.purchase_items drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.purchase_items
  add constraint purchase_items_item_type_check
  check (item_type in ('digital', 'merch', 'audio_visual'));

-- A purchase_items row must identify what was purchased one way or the
-- other — a slug-based catalog item, or an ID-based Audio Visual video —
-- never neither (which would mean recordPurchaseItems silently dropped
-- the identity entirely, exactly the bug this migration fixes).
alter table public.purchase_items
  add constraint purchase_items_identifies_item_check
  check (product_slug is not null or audio_visual_id is not null);
