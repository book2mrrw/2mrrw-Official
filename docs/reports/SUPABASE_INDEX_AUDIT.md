# Supabase Index Audit — Phase 11 Step 4

**Date:** 2026-05-24  
**Repos audited:** `artist-platform` (storefront API queries), migrations in `supabase/migrations/`

## Summary

Required user-scoped indexes for vault/library/entitlement tables are **present** in baseline migrations. No new migration was required for Phase 11.

## Tables and indexes verified

| Table | Query patterns (storefront) | Indexes found |
|-------|----------------------------|---------------|
| `library_items` | `.eq("user_id")`, join on `product_id` | `library_items_user_id_idx`, `library_items_product_id_idx` (`001_auth_commerce_library.sql`) |
| `entitlements` | `.eq("user_id")`, resource filters | `entitlements_user_resource_idx`, `entitlements_source_idx` (`20260601000000_unified_entitlements.sql`) |
| `purchases` | `.eq("user_id")`, status, time ordering | `purchases_user_id_idx`, `purchases_status_idx`, `purchases_purchased_at_idx` (`001_auth_commerce_library.sql`) |
| `gifts` | recipient/sender/status (cron, redeem) | `idx_gifts_token_hash` on `gift_link_token_hash`; status filters use table scans on small cron batches — acceptable at current scale |
| `user_entitlements` | flags by user | `user_entitlements_subscriber_idx`, `user_entitlements_vault_idx`, `user_entitlements_collector_idx` (`20260603000002_user_entitlements.sql`) |
| `vault_entitlements` | tier access checks | Queried via `user_id` in `src/lib/commerce/entitlements.js` — covered by user-scoped entitlement paths |

## `vault_items` table

No `.from('vault_items')` usage in `artist-platform`. Vault content is served via `products`, `/api/vault/*`, and control-system catalog — not a separate `vault_items` table in storefront queries.

## Recommended `EXPLAIN ANALYZE` (run in Supabase SQL editor)

```sql
EXPLAIN ANALYZE
SELECT * FROM library_items WHERE user_id = '<uuid>' ORDER BY granted_at DESC LIMIT 50;

EXPLAIN ANALYZE
SELECT * FROM entitlements WHERE user_id = '<uuid>' AND revoked_at IS NULL;

EXPLAIN ANALYZE
SELECT * FROM purchases WHERE user_id = '<uuid>' AND status = 'completed' ORDER BY purchased_at DESC LIMIT 20;
```

Expected: **Index Scan** or **Bitmap Index Scan** on `user_id` / composite indexes — not sequential scans on large row counts.

## Control System repo

`2MRRW-Control-System` was not present in the local workspace for this run. Re-run this audit against control-system `src/` Supabase queries before scaling admin catalog operations.

## Action

- **Migration added:** none (indexes already exist)
- **Deploy order:** N/A
