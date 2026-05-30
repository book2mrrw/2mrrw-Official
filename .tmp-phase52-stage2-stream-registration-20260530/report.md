# Phase 5.2 — Stage 2: Stream Asset Registration

**Date:** 2026-05-30  
**Phase:** HYBRID MASTER / STREAM IMPLEMENTATION — Stage 2 only  
**Repository:** `/Users/recharge/artist-platform`  
**Recovery anchor:** `bac9eb71f93dcbc0bee4099bf6d80ddaac29e049` (`bac9eb7`) — unchanged

---

## Executive summary

Stage 2 delivers **stream asset metadata schema**, **R2 path conventions** under `streaming/`, **registration helpers**, and **validation utilities**. All registration paths are **inert when `HYBRID_STREAMING_ENABLED=false`** (default). No playback resolver, upload transcode, entitlement, or API routing changes.

---

## Files modified

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/media/constants/storage-domains.js` | **Modified** | Added `STREAM_ROOT = "streaming"` |
| `src/lib/media/canonical-paths.js` | **Modified** | Stream path/key builders (`resolveStreamPath`, `resolveStreamKey`, `streamFilenameFromSlug`, `streamPathForProductRow`) |
| `src/lib/media/canonical-catalog.js` | **Modified** | `stream_folder` per release type; `attachStreamRegistrationToRow` on canonical product/track rows (inert when flag OFF) |
| `src/lib/media/stream-asset-schema.js` | **Created** | In-code canonical metadata fields, constants, JSDoc types |
| `src/lib/media/stream-registration-validation.js` | **Created** | Pure validation: slugs, release types, paths, keys, format constraints |
| `src/lib/media/stream-registration.js` | **Created** | `registerStreamAsset`, `buildStreamRegistrationMetadata`, `attachStreamRegistrationToRow`, row resolvers |
| `supabase/migrations/20260530160000_stream_asset_registration.sql` | **Created** | Additive `stream_path` / `stream_key` columns on `products` and `catalog_tracks` |

**Not modified:** `resolve-playback-key.js`, `AudioContext.js`, `music-access.js`, playback/stream API routes, upload transcode, backfill tooling, recovery anchors, audiovisual systems.

---

## Schema changes

### Supabase (additive migration)

| Table | Columns | Notes |
|-------|---------|-------|
| `products` | `stream_path text`, `stream_key text` | Nullable; entity folder + full R2 key |
| `catalog_tracks` | `stream_path text`, `stream_key text` | Nullable; per-track stream paths |

Column comments document AAC `.m4a` convention and HQ suffix `_192`.

### In-code schema (`stream-asset-schema.js`)

| Constant / key | Value |
|----------------|-------|
| `STREAM_ASSET_ROLE` | `stream_audio` |
| `STREAM_AUDIO_FORMAT` | `aac-lc` |
| `STREAM_CONTAINER_FORMAT` | `m4a` |
| `STREAM_QUALITY_TIERS` | `standard` (128 kbps), `hq` (192 kbps) |
| `STREAM_METADATA_KEYS` | `stream_path`, `stream_key`, `stream_path_relative`, `stream_asset_role`, `stream_format`, `stream_container`, `stream_quality` |

---

## R2 path convention

Mirrors master entity folders under `streaming/`:

```
streaming/singles/hour-glass/hour-glass.m4a
streaming/features/i-dont-believe-you/i-dont-believe-you.m4a
streaming/mixtapes-and-eps/love-hz-vol-1/01-roll-call/01-roll-call.m4a
streaming/albums/{album-slug}/{track-slug}/{track-slug}.m4a
```

HQ tier: `{slug}_192.m4a` via `STREAM_HQ_FILENAME_SUFFIX`.

Builders: `resolveStreamPath`, `resolveStreamKey`, `streamFilenameFromSlug`, `streamPathForProductRow`.

---

## Registration API

```js
import {
  registerStreamAsset,
  validateStreamRegistration,
  buildStreamRegistrationMetadata,
  attachStreamRegistrationToRow,
  resolveStreamPathFromRow,
  resolveStreamKeyFromRow,
} from "@/lib/media/stream-registration";
```

- `validateStreamRegistration(input)` — always available; validates slugs, release types, canonical paths/keys
- `registerStreamAsset(input)` — validates then returns registration when flag ON; `{ skipped: true }` when flag OFF
- `buildStreamRegistrationMetadata` / `attachStreamRegistrationToRow` — flag-gated metadata emission
- `resolveStreamPathFromRow` / `resolveStreamKeyFromRow` — convention-only (no flag gate; diagnostics/admin)

---

## Metadata changes

When `HYBRID_STREAMING_ENABLED=true`, catalog row helpers may attach:

```json
{
  "stream_path": "streaming/singles/hour-glass/",
  "stream_key": "streaming/singles/hour-glass/hour-glass.m4a",
  "stream_path_relative": "singles/hour-glass/",
  "stream_asset_role": "stream_audio",
  "stream_format": "aac-lc",
  "stream_container": "m4a",
  "stream_quality": "standard"
}
```

**Default (flag OFF):** no stream fields added; platform behavior identical to pre–Stage 2.

---

## Validation results

| Check | Result |
|-------|--------|
| `npm run build` | ✅ **PASS** |
| `npm run test:foundation` | ✅ **PASS** |
| `npm run verify:foundation -- --quick` | ✅ **PASS** (guardrails 0 errors; PostHog env keys missing locally — pre-existing) |
| Prohibited files unchanged | ✅ Confirmed — `resolve-playback-key.js`, `AudioContext.js`, `music-access.js`, stream/preview API routes |
| Recovery anchor drift | ✅ **0** — operational anchor still `bac9eb7` |
| Playback behavior | ✅ **Unchanged** — master-only; resolver not wired |

---

## Rollback procedure

1. **Immediate (no deploy):** Keep `HYBRID_STREAMING_ENABLED=0` — registration helpers are inert (default).
2. **Code rollback:** Revert Stage 2 files listed above; delete `src/lib/media/stream-*.js` and migration file.
3. **Database rollback (optional):**
   ```sql
   alter table public.products drop column if exists stream_path, drop column if exists stream_key;
   alter table public.catalog_tracks drop column if exists stream_path, drop column if exists stream_key;
   ```
4. Masters, `storage_path`, previews, entitlements — **untouched**; no data restore required.

---

## Risks introduced

| Risk | Severity | Mitigation |
|------|----------|------------|
| Accidental stream metadata in catalog sync | **Low** | Flag-gated; default OFF |
| Path convention drift | **Low** | Single source in `canonical-paths.js` + validation |
| Nullable DB columns unused | **None** | Additive only; ignored until Stage 3+ |
| Resolver premature wiring | **None** | Stage 4 scope; prohibited files untouched |

---

## Stages not implemented (awaiting approval)

| Stage | Scope | Status |
|-------|-------|--------|
| 3 | Upload transcode pipeline | ⏸ Pending |
| 4 | Resolver stream-first + fallback | ⏸ Pending |
| 5 | Backfill transcoding queue | ⏸ Pending |
| 6 | Shadow mode / admin diagnostics | ⏸ Pending |
| 7 | Staging canary / prod rollout | ⏸ Pending |

---

## STOP — awaiting Stage 3 approval

Stage 2 is complete. **Do not proceed** to upload transcode, resolver changes, or backfill until explicit approval.
