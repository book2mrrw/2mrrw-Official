-- Separate physical NFC registry from digital access grants on the card row.

alter table public.collector_cards
  add column if not exists nfc_enabled boolean not null default true;

alter table public.collector_cards
  add column if not exists digital_access_granted boolean not null default false;

comment on column public.collector_cards.nfc_enabled is 'Physical NFC tap enabled; independent of digital_access_granted.';
comment on column public.collector_cards.digital_access_granted is 'True when digital entitlements (streaming/vault) are active for claimed card.';

update public.collector_cards
set digital_access_granted = true
where claimed = true
  and verification_status in ('claimed', 'verified', 'active')
  and digital_access_granted = false;
