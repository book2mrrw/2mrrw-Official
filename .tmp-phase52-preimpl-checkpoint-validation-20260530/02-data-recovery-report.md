# 02 — Data Recovery Report

**Phase:** 5.2 Pre-Implementation Checkpoint Validation  
**Date:** 2026-05-30  
**Mode:** Read-only audit

---

## Verdict: **CONDITIONAL PASS**

Database schema, catalog metadata, and entitlement mappings are **recoverable via idempotent Supabase migrations + canonical catalog**, but recovery scripts do **not** include automated DB snapshot/restore. Rollback to pre-Phase-5.2 data state requires migration replay or Supabase point-in-time recovery (external to repo).

---

## Schema recovery

### Migrations inventory

**38 migration files** under `supabase/migrations/`, covering:

| Domain | Key migrations | Recoverable? |
|--------|----------------|--------------|
| Auth / commerce / library | `001_auth_commerce_library.sql` | ✅ Idempotent patterns |
| Collector ownership | `007_collector_ownership_ledger.sql` | ✅ Ledger table |
| Vault entitlements | `008_vault_entitlement_persistence.sql` | ✅ |
| Community / signals | `006_*`, `20260517045500_*` | ✅ |
| Stripe idempotency | `20260521120000_processed_stripe_events.sql` | ✅ |
| Canonical media metadata | `20260529120000_canonical_media_metadata.sql` | ✅ Seeds products + catalog_tracks |
| Entity folder paths | `20260529130000_*`, `20260529140000_*`, `20260529150000_*` | ✅ R2 path normalization |
| Unified entitlements | `20260601000000_unified_entitlements.sql`, `20260603000002_user_entitlements.sql` | ✅ |
| Stream sessions (future) | `20260603000000_stream_sessions.sql`, `20260603000005_stream_events.sql` | ✅ Present; unused by current master-only playback |

**Gap:** No `scripts/recovery/` step applies or validates migrations against live Supabase.

---

## Canonical catalog

**Source of truth:** `src/lib/media/canonical-catalog.js`

| Content | Count | DB parity |
|---------|------:|-----------|
| Singles | 4 | Seeded in `20260529120000_canonical_media_metadata.sql` |
| Features | 2 | Seeded |
| Mixtapes & EPs | 3 releases / 30 tracks | Seeded via `catalog_tracks` |
| **Total playable entities** | **36** | Code + migration aligned |

Supporting modules:

- `src/lib/media/canonical-paths.js` — R2 key construction
- `src/lib/media/normalize-release-type.js` — release type normalization
- `src/lib/media/entity-resolver.js` — folder discovery

**Recovery without manual catalog rebuild:** ✅ Yes — migrations re-seed canonical rows; JS catalog is version-controlled.

---

## Account state / entitlements

**Endpoint:** `GET /api/account/state` (`src/app/api/account/state/route.js`)

Entitlement flow (unchanged, validated):

```
Stripe webhook → Supabase (memberships, library_items, user_entitlements, collector_ownerships)
              → /api/account/state → AuthContext (display only)
```

| Mapping | Storage | Pre-Phase-5.2 restorable? |
|---------|---------|---------------------------|
| Subscriber | `memberships`, `user_entitlements.subscriber` | ✅ |
| Vault pass | vault tables + entitlements | ✅ |
| Collector card | `collector_ownerships`, card tables | ✅ |
| Library / purchase ownership | `library_items`, purchases | ✅ |
| Owned slugs | Computed in account state | ✅ |

**Gap:** Account state is live DB — not captured in frontend recovery scripts. Production rollback = DB unchanged (Phase 5.2 adds no schema until implemented).

---

## Playback / resolver data mappings

| Layer | Table / source | Master-only today |
|-------|------------------|-------------------|
| Product slug → storage_path | `products.storage_path` | ✅ |
| Album tracks | `catalog_tracks` | ✅ |
| Media assets | `media_assets`, `release_media` | ✅ |
| Resolver fallback | `resolve-playback-key.js` + canonical catalog | ✅ |

No `streaming/` rows or stream asset registrations exist in current codebase — **pre-Phase-5.2 data state is master-only**.

---

## Releases & products

- Products seeded in canonical migration with `storage_path`, `preview_path`, `artwork_path`, `video_path`
- Admin sync routes: `/api/admin/sync/catalog`, `/api/admin/seed-products`
- Collector products: `010_release_commerce_extensions.sql`, collector card migrations

---

## Collector & vault refs

| Asset | Reference location | Hybrid impact (Phase 5.2) |
|-------|-------------------|----------------------------|
| Vault media | `vault` APIs + signed paths | Masters unchanged |
| Collector downloads | `/api/access/[token]` uses `DIGITAL_ASSETS` + `products.storage_path` | Isolated from playback resolver |
| Collector ownership ledger | `007_collector_ownership_ledger.sql` | No stream entitlement class planned |

---

## Recovery script coverage

| Capability | In `scripts/recovery/`? |
|------------|-------------------------|
| Git / npm / env verify | ✅ |
| Supabase migration apply | ❌ |
| DB snapshot restore | ❌ |
| Catalog re-seed trigger | ❌ (manual: run migrations or admin sync) |

---

## Gaps

1. No integrated DB recovery in foundation scripts
2. Live production DB state not versioned with git checkpoints
3. Stream session tables exist in migrations but are forward-looking — verify prod has not applied unused migrations that would complicate rollback
4. `.env.example` may not enumerate all R2/Supabase keys (env-check validates key names only when present)

---

## Layer 2 conclusion

| Criterion | Result |
|-----------|--------|
| Schema reproducible from migrations | ✅ |
| Catalog metadata dual-written (code + DB) | ✅ |
| Entitlement mappings server-authoritative | ✅ |
| Automated DB rollback in recovery scripts | ❌ |
| Pre-Phase-5.2 master-only data state | ✅ (no stream data yet) |

**Layer 2 — Data Recovery: CONDITIONAL PASS**

*Condition: Accept that DB recovery is migration-replay / Supabase PITR, not npm recover:foundation.*
