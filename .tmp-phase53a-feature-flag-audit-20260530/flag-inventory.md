# Phase 5.3A — Hybrid Streaming Flag Inventory

**Audit date:** 2026-05-30  
**Definition module:** `src/lib/feature-flags/hybrid-streaming.js`  
**Barrel export:** `src/lib/feature-flags/index.js`

All flags are **server-side only** (no `NEXT_PUBLIC_` prefix). Client cannot read or override them.

---

## Truthy / falsy parsing

| Input | Parsed as |
|-------|-----------|
| unset, `""` | `false` |
| `0`, `false`, any other string | `false` |
| `1`, `true` (case-insensitive) | `true` |

Parser: `readHybridStreamingEnvBool(raw)` in `hybrid-streaming.js`.

---

## Flag 1: `HYBRID_STREAMING_ENABLED`

### Definition

| Property | Value |
|----------|-------|
| **Location** | `src/lib/feature-flags/hybrid-streaming.js` |
| **Reader** | `isHybridStreamingEnabled()` |
| **Default** | `false` (unset env var) |
| **Role** | Master switch for all hybrid streaming code paths |

### Consuming files and functions

| File | Function / usage | Behavior when OFF | Behavior when ON |
|------|------------------|-------------------|------------------|
| `src/lib/feature-flags/hybrid-streaming.js` | `isHybridStreamingEnabled()` | Returns `false` | Returns `true` if env `1`/`true` |
| `src/lib/feature-flags/hybrid-streaming.js` | `isStreamPlaybackPreferred()` | Always `false` (short-circuit) | Delegates to `STREAM_PLAYBACK_PREFERRED` |
| `src/lib/feature-flags/hybrid-streaming.js` | `isAutoGenerateStreamAssetsEnabled()` | Always `false` (short-circuit) | Delegates to `AUTO_GENERATE_STREAM_ASSETS` |
| `src/lib/media/stream-registration.js` | `buildStreamRegistrationMetadata()` | Returns `null` — no metadata | Builds stream path/key metadata |
| `src/lib/media/stream-registration.js` | `registerStreamAsset()` | `{ ok: true, skipped: true, reason: "hybrid_streaming_disabled" }` | Returns registration payload |
| `src/lib/media/stream-registration.js` | `attachStreamRegistrationToRow()` | Returns input row unchanged | Attaches `stream_path`, `stream_key`, metadata |
| `scripts/backfill-stream-assets.mjs` | Gate + diagnostics | Refuses run unless `--yes` or env set | Allows backfill when combined with `AUTO_GENERATE` |
| `scripts/test-playback-resolver-fallback.mjs` | Flag matrix tests | Validates master-only paths | Validates hybrid paths |

### Runtime summary

- **OFF:** Stream registration helpers are inert. Sub-flags cannot activate. Platform = pre–Phase 5.2.
- **ON alone:** Registration helpers emit metadata; upload/resolver sub-flags still require their own env vars.

---

## Flag 2: `STREAM_PLAYBACK_PREFERRED`

### Definition

| Property | Value |
|----------|-------|
| **Location** | `src/lib/feature-flags/hybrid-streaming.js` |
| **Reader** | `isStreamPlaybackPreferred()` |
| **Default** | `false` (unset) |
| **Gate** | `HYBRID_STREAMING_ENABLED && STREAM_PLAYBACK_PREFERRED` |
| **Role** | Prefer AAC stream renditions over masters for entitled playback |

### Consuming files and functions

| File | Function / usage | Behavior when OFF | Behavior when ON |
|------|------------------|-------------------|------------------|
| `src/lib/playback/resolve-stream-playback.js` | `tryResolveStreamPlaybackKey()` | `{ ok: false, fallbackReason: "flags_off" }` | Looks up `stream_key`/`stream_path` from DB, R2 HEAD, returns stream key or fallback reason |
| `src/lib/playback/resolve-playback-key.js` | `resolvePlaybackKey()` (master branch) | Master key returned; no stream attempt | After master resolve, attempts stream; on success replaces `audioKey` with stream key; on failure keeps master |
| `src/app/api/library/stream/route.js` | `applyResolverDiagnosticsHeaders()` | `flags.streamPlaybackPreferred: false` in `X-Playback-Resolver` (debug only) | Same header reflects `true` when both flags on |
| `scripts/test-playback-resolver-fallback.mjs` | 21 scenarios | Master-only gate tests | Stream-hit and fallback tests |

### Runtime summary

- **OFF (default):** `/api/library/stream` resolves master keys only. Preview path unchanged. No latency change vs pre–5.2.
- **ON (with HYBRID=1):** After master key discovered, resolver tries registered stream asset via R2 HEAD. Any miss falls back to master — playback never interrupted.

### Fallback reasons (when ON but stream not served)

| Reason | Meaning |
|--------|---------|
| `flags_off` | Preferred flag or master flag off |
| `no_stream_registration` | No `stream_key` in DB/metadata |
| `invalid_stream_key` | Validation failed |
| `invalid_stream_path` | Path validation failed |
| `r2_missing` | Stream key not found in R2 |
| `resolver_error` | Unexpected exception — master kept |

---

## Flag 3: `AUTO_GENERATE_STREAM_ASSETS`

### Definition

| Property | Value |
|----------|-------|
| **Location** | `src/lib/feature-flags/hybrid-streaming.js` |
| **Reader** | `isAutoGenerateStreamAssetsEnabled()` |
| **Default** | `false` (unset) |
| **Gate** | `HYBRID_STREAMING_ENABLED && AUTO_GENERATE_STREAM_ASSETS` |
| **Role** | Post-master transcode → R2 `streaming/` upload → DB registration |

### Consuming files and functions

| File | Function / usage | Behavior when OFF | Behavior when ON |
|------|------------------|-------------------|------------------|
| `src/lib/media/stream-upload-pipeline.js` | `generateStreamAssetForCatalogEntity()` | `{ ok: true, skipped: true, reason: "auto_generate_disabled" }` | Transcode master → upload stream → persist `stream_path`/`stream_key` |
| `src/lib/media/stream-upload-pipeline.js` | `generateStreamAssetForCatalogTrack()` | Same skip | Per-track transcode for albums/mixtapes/EPs |
| `src/lib/media/stream-upload-pipeline.js` | `maybeGenerateStreamAfterCatalogSync()` | Same skip | Called after product upsert |
| `src/app/api/admin/sync/catalog/route.js` | `POST` handler | Master upsert only; no `streamResults` in response | After each product upsert, runs `maybeGenerateStreamAfterCatalogSync`; failures logged, never block master |
| `scripts/backfill-stream-assets.mjs` | CLI gate | Refuses unless env + `--yes` | Resumable batch transcode for existing catalog |

### Runtime summary

- **OFF (default):** Admin catalog sync identical to pre–5.2. No ffmpeg invocation. No R2 writes to `streaming/`.
- **ON (with HYBRID=1):** After successful master upsert, pipeline downloads master from R2, ffmpeg AAC-LC 192k `+faststart`, uploads to `streaming/{release-type}/...`, updates DB. Master upsert always succeeds first; stream errors appear in `streamResults` only.

### Dependencies when ON

| Dependency | Required for |
|------------|--------------|
| `CLOUDFLARE_R2_*` credentials | Download master, upload stream |
| ffmpeg (`FFMPEG_PATH` or PATH) | Transcode |
| Supabase migration `20260530160000_*` | Persist `stream_path`/`stream_key` columns |
| Valid `release_type` on catalog row | Path/key derivation |

---

## Diagnostic API (all flags)

| File | Function | Purpose |
|------|----------|---------|
| `src/lib/feature-flags/hybrid-streaming.js` | `getHybridStreamingFeatureFlags()` | Snapshot object for logging |
| `src/app/api/library/stream/route.js` | `X-Playback-Resolver` header | Dev/debug only when `R2_STREAM_DEBUG=1` or `NODE_ENV=development` |

---

## Full grep reference count

| Pattern | Matches (excluding `.tmp-*` audit artifacts) |
|---------|-----------------------------------------------|
| `HYBRID_STREAMING_ENABLED` | 15 source/script locations |
| `STREAM_PLAYBACK_PREFERRED` | 12 source/script locations |
| `AUTO_GENERATE_STREAM_ASSETS` | 14 source/script locations |

**Source/runtime files (production path):**

```
src/lib/feature-flags/hybrid-streaming.js
src/lib/feature-flags/index.js
src/lib/media/stream-registration.js
src/lib/media/stream-upload-pipeline.js
src/lib/playback/resolve-stream-playback.js
src/lib/playback/resolve-playback-key.js
src/app/api/library/stream/route.js
src/app/api/admin/sync/catalog/route.js
scripts/backfill-stream-assets.mjs
scripts/test-playback-resolver-fallback.mjs
```

**Explicitly NOT consuming flags (unchanged Phase 5.2):**

- `src/context/AudioContext.js`
- `GlobalAudioPlayerBar`
- Entitlement webhooks / `/api/account/state`
- Cinematic shell / `src/app/page.js`
- Collector download routes

---

## Flag combination matrix

| HYBRID | PREFERRED | AUTO | Upload transcode | Playback resolver |
|--------|-----------|------|------------------|-------------------|
| OFF | * | * | Skipped | Master only |
| ON | OFF | OFF | Skipped | Master only |
| ON | OFF | ON | Runs on sync/backfill | Master only (safe staging) |
| ON | ON | OFF | Skipped | Stream-first + master fallback |
| ON | ON | ON | Runs on sync/backfill | Stream-first + master fallback |
