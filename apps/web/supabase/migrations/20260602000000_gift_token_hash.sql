-- Hash gift link tokens at rest (lookup by SHA-256 hex; raw token only in email/URL).

alter table public.gifts
  add column if not exists gift_link_token_hash text;

create unique index if not exists idx_gifts_token_hash
  on public.gifts (gift_link_token_hash)
  where gift_link_token_hash is not null;

-- Backfill hashes for existing plaintext tokens.
update public.gifts
set gift_link_token_hash = encode(digest(gift_link_token, 'sha256'), 'hex')
where gift_link_token is not null
  and gift_link_token_hash is null;
