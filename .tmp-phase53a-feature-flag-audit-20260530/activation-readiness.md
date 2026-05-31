# Phase 5.3A — Activation Readiness

**Audit date:** 2026-05-30  
**Overall:** **FAIL** (code ready; operator prerequisites incomplete)

Each subsystem scored **PASS**, **CONDITIONAL PASS**, or **FAIL** against Phase 5.2 stage completion criteria.

---

## Summary table

| Subsystem | Stage | Result | Evidence |
|-----------|-------|--------|----------|
| Upload pipeline | 3 | **CONDITIONAL PASS** | Code wired; ffmpeg + migration + ops path required |
| Stream registration | 2 + migration | **FAIL** | Migration file exists; apply pending |
| Playback resolver | 4 | **PASS** | Stream-first gate + master fallback in production resolver |
| Master fallback tests | 5 | **PASS** | 21/21 automated (re-run 2026-05-30) |
| Rollback readiness | — | **PASS** | Env-only; 21 scenarios; recovery anchor intact |

---

## 1. Upload pipeline readiness (Stage 3)

**Result: CONDITIONAL PASS**

### Code readiness — PASS

| Check | Status |
|-------|--------|
| `src/lib/media/stream-upload-pipeline.js` exists | ✅ |
| `src/lib/media/stream-transcode.js` (ffmpeg AAC-LC 192k) | ✅ |
| `src/lib/media/r2-object-transfer.js` | ✅ |
| `POST /api/admin/sync/catalog` post-upsert hook | ✅ |
| Master upsert never blocked by stream failure | ✅ |
| Gated by `isAutoGenerateStreamAssetsEnabled()` | ✅ |

### Operational readiness — CONDITIONAL

| Check | Status | Notes |
|-------|--------|-------|
| ffmpeg on operator machine | Unknown | Required for backfill CLI |
| ffmpeg on Vercel serverless | **Likely unavailable** | Stage 3 report: medium risk; failures non-blocking |
| R2 credentials in deploy env | Assumed ✅ | Pre-existing for master playback |
| Flags OFF in production | ✅ | Verified local; Vercel unverified |
| Backfill CLI | ✅ | `npm run backfill:stream-assets` |
| Backfill dry-run (Phase 5.2) | ✅ | 36 candidates enumerated |
| Backfill dry-run (this audit) | ⚠️ | Sandbox network blocked Supabase fetch; Phase 5.2 result stands |

### Blockers before enabling `AUTO_GENERATE_STREAM_ASSETS=1`

1. Apply Supabase migration
2. Confirm ffmpeg available on chosen transcode host (local/CI, not necessarily Vercel)
3. Run limited backfill (`--limit N`) before enabling sync hook in production

---

## 2. Stream registration readiness (Stage 2 + migration)

**Result: FAIL**

### Code readiness — PASS

| Check | Status |
|-------|--------|
| `src/lib/media/stream-registration.js` | ✅ |
| `src/lib/media/stream-asset-schema.js` | ✅ |
| `src/lib/media/stream-registration-validation.js` | ✅ |
| R2 path convention `streaming/` in `canonical-paths.js` | ✅ |
| `registerStreamAsset` inert when HYBRID=0 | ✅ |

### Migration readiness — FAIL

| Check | Status |
|-------|--------|
| Migration file `supabase/migrations/20260530160000_stream_asset_registration.sql` | ✅ Present |
| Columns `products.stream_path`, `products.stream_key` | ⏳ **Pending apply** |
| Columns `catalog_tracks.stream_path`, `catalog_tracks.stream_key` | ⏳ **Pending apply** |
| Phase 5.2 operator checklist item 1 | ☐ Unchecked |

**Impact while migration pending:** Registration writes from upload pipeline or backfill may fail at DB layer. Playback unaffected (flags OFF). Metadata-only fallback possible in some code paths but not production-safe for activation.

---

## 3. Resolver readiness (Stage 4)

**Result: PASS**

| Check | Status |
|-------|--------|
| `src/lib/playback/resolve-stream-playback.js` | ✅ |
| `src/lib/playback/resolve-playback-key.js` stream gate | ✅ |
| `src/lib/media/entity-resolver.js` `resolveStreamAssetKey()` R2 HEAD | ✅ |
| `src/lib/playback/playback-resolver-diagnostics.js` | ✅ |
| `/api/library/stream` Server-Timing + debug headers | ✅ |
| Entitlements unchanged (`userCanStreamProduct`) | ✅ |
| Client playback unchanged (`AudioContext`) | ✅ |
| Default behavior (flags OFF) = master-only | ✅ |

**Activation note:** Enabling `STREAM_PLAYBACK_PREFERRED=1` requires pre-existing stream assets in R2 + DB registration for latency benefit. Without assets, resolver falls back to master (safe).

---

## 4. Fallback readiness (Stage 5 tests)

**Result: PASS**

```bash
npm run test:playback-resolver-fallback
# scenarios: 21 passed (2026-05-30 audit re-run)
```

| Category | Scenarios | Status |
|----------|-----------|--------|
| Registration pickers | 5 | PASS |
| Validation | 3 | PASS |
| Flag combinations | 3 | PASS |
| Fallback paths | 5 | PASS |
| Stream hit | 1 | PASS |
| Resolve gate simulation | 3 | PASS |
| Shadow metrics | 1 | PASS |

Key proven behaviors:

- `HYBRID=0, PREFERRED=1` → preferred effectively false
- `HYBRID=1, PREFERRED=0` → master only, reason `flags_off`
- R2 miss → master retained, reason `r2_missing`
- Invalid stream key/path → master retained

---

## 5. Rollback readiness

**Result: PASS**

| Mechanism | Validated | Notes |
|-----------|-----------|-------|
| Env toggle all flags to `0` | ✅ | 21 test scenarios |
| `STREAM_PLAYBACK_PREFERRED=0` alone restores master | ✅ | Even if HYBRID=1 |
| Masters in `digital-assets/` never modified | ✅ | Architecture invariant |
| Stream objects in `streaming/` optional delete | ✅ | No playback impact when flags OFF |
| Recovery anchor `bac9eb7` | ✅ | Unchanged |
| `npm run recover:foundation -- --dry-run` | Available | Emergency code rollback |
| Selective restore workflow | Documented | `docs/workflow/SELECTIVE_RESTORATION_WORKFLOW.md` |

**Rollback time:** <5 min env propagation (Vercel); no data restore required.

---

## Gate criteria for activation approval

All must be **PASS** before production flag enablement:

| # | Criterion | Current |
|---|-----------|---------|
| 1 | Supabase migration applied | ❌ FAIL |
| 2 | Phase 5.2 deployed to staging (flags OFF) | ⏳ Operator |
| 3 | Backfill dry-run reviewed | ✅ (Phase 5.2) |
| 4 | Limited live backfill successful | ⏳ Operator |
| 5 | Staging canary playback validated | ⏳ Operator |
| 6 | Mobile Safari manual check (flags ON) | ⏳ Pending |
| 7 | Rollback drill in staging | ⏳ Operator |
| 8 | Vercel prod flags confirmed OFF | ⏳ Unverified |

**Recommendation:** Resolve FAIL items before any `=1` in Production.
