# Phase 5.2 — Stage 3: Upload Pipeline Extension

**Date:** 2026-05-30  
**Phase:** HYBRID MASTER / STREAM IMPLEMENTATION — Stage 3 only  
**Repository:** `/Users/recharge/artist-platform`  
**Recovery anchor:** `bac9eb71f93dcbc0bee4099bf6d80ddaac29e049` (`bac9eb7`) — unchanged

---

## Executive summary

Stage 3 extends the **admin catalog sync upload path** with an optional post-master stream generation step. When `HYBRID_STREAMING_ENABLED=1` **and** `AUTO_GENERATE_STREAM_ASSETS=1`, the pipeline downloads the master from R2, transcodes to **AAC-LC 192 kbps** with `+faststart`, uploads to `streaming/` paths, and registers `stream_path` / `stream_key` via Stage 2 helpers.

**Default (flags OFF):** upload behavior is **identical to pre–Phase 5.2** — no transcode, no R2 stream writes, no DB stream columns updated.

Master product upsert **always succeeds first**; stream generation failures are logged and returned in `streamResults` but **never block** catalog sync, release availability, ownership assets, or collector downloads.

---

## Files modified / created

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/media/stream-upload-pipeline.js` | **Created** | Orchestration: master resolve → transcode → R2 upload → DB registration |
| `src/lib/media/stream-transcode.js` | **Created** | ffmpeg AAC-LC transcode (`-c:a aac -b:a 192k -movflags +faststart`) |
| `src/lib/media/r2-object-transfer.js` | **Created** | R2 GetObject/PutObject helpers for stream pipeline |
| `src/app/api/admin/sync/catalog/route.js` | **Modified** | Post-upsert hook: `maybeGenerateStreamAfterCatalogSync` (non-blocking) |

**Stage 1–2 dependencies (unchanged this stage, required):**

- `src/lib/feature-flags/hybrid-streaming.js` — `isAutoGenerateStreamAssetsEnabled()` gates transcode
- `src/lib/media/stream-registration.js` — `registerStreamAsset`, path/key builders
- `src/lib/media/stream-asset-schema.js` — codec/format constants, bitrate tiers
- `supabase/migrations/20260530160000_stream_asset_registration.sql` — `stream_path` / `stream_key` columns

**Not modified (prohibited):** `resolve-playback-key.js`, `AudioContext.js`, playback/stream API routes, entitlement systems, ownership/collector download logic, audiovisual systems, storefront rendering, recovery anchors.

---

## Upload flow diagram

```mermaid
flowchart TD
  A[Control System / ops uploads master to R2] --> B[POST /api/admin/sync/catalog]
  B --> C{Authorize + rate limit}
  C -->|fail| Z[401 / 429]
  C -->|ok| D[Upsert vault_content rows]
  D --> E[For each product row]
  E --> F[Normalize storage_path + preview_path]
  F --> G[Upsert products row — MASTER AUTHORITATIVE]
  G -->|DB error| H[Record in failed[] — continue loop]
  G -->|success| I{AUTO_GENERATE_STREAM_ASSETS enabled?}
  I -->|no| J[Next product — identical to pre-5.2]
  I -->|yes| K[maybeGenerateStreamAfterCatalogSync]
  K --> L{Stream outcome}
  L -->|ok / skipped| M[Append streamResults]
  L -->|error| N[Log + append streamResults — NO rollback]
  M --> E
  N --> E
  J --> E
  E --> O[200 JSON: vaultUpserted, productUpserted, failed, streamResults?]
```

---

## Stream generation flow

```mermaid
flowchart TD
  S1[isAutoGenerateStreamAssetsEnabled?] -->|no| SKIP1[skipped: auto_generate_disabled]
  S1 -->|yes| S2[resolveReleaseTypeFromCatalogRow]
  S2 --> S3[registerStreamAsset — Stage 2 helper]
  S3 -->|hybrid off| SKIP2[skipped: hybrid_streaming_disabled]
  S3 -->|invalid| ERR1[ok: false — logged in streamResults]
  S3 -->|ok| S4{Stream object exists in R2?}
  S4 -->|yes, !force| S5[Persist stream_path/stream_key only]
  S4 -->|no| S6[resolveMasterR2Key via entity-resolver]
  S6 -->|missing| ERR2[ok: false — master_not_found]
  S6 -->|found| S7[Download master buffer from R2]
  S7 --> S8[ffmpeg AAC-LC 192k +faststart → temp .m4a]
  S8 --> S9[Upload to streaming/…/{slug}_192.m4a]
  S9 --> S10[persistStreamRegistrationForProduct]
  S10 --> OK[ok: true + registration metadata]
  S5 --> OK
```

**Transcode settings:**

| Parameter | Value |
|-----------|-------|
| Codec | AAC-LC (`-c:a aac`) |
| Bitrate | 192 kbps (`-b:a 192k`) — HQ tier |
| Container | `.m4a` with moov at front (`-movflags +faststart`) |
| R2 destination | `streaming/{release-type}/{slug}/…/{slug}_192.m4a` |
| ffmpeg | `FFMPEG_PATH` env or `ffmpeg` on PATH |

---

## Failure handling behavior

| Failure | Master upsert | Release available | streamResults | User impact |
|---------|---------------|-------------------|---------------|-------------|
| Product DB upsert error | ❌ recorded in `failed[]` | No (row not written) | N/A | Same as today |
| ffmpeg unavailable | ✅ succeeded | ✅ yes | `{ ok: false, error: "ffmpeg unavailable…" }` | Master playback unchanged (Stage 4 not wired) |
| Master not in R2 | ✅ succeeded | ✅ yes | `{ ok: false, error: "master_not_found" }` | Same |
| Transcode error | ✅ succeeded | ✅ yes | `{ ok: false, error: "…" }` | Same |
| R2 upload error | ✅ succeeded | ✅ yes | `{ ok: false, error: "…" }` | Same |
| DB stream registration error | ✅ succeeded | ✅ yes | `{ ok: false, error: "…" }` | Master path intact |
| Invalid release_type | ✅ succeeded | ✅ yes | `{ ok: false, error: "invalid_or_missing_release_type" }` | Same |
| Uncaught exception in hook | ✅ succeeded | ✅ yes | `{ ok: false, error: "…" }` | Caught in route try/catch |

**Principles:**

1. Master storage and product upsert complete **before** any stream work begins.
2. Stream hook wrapped in try/catch — **never throws** to the sync handler.
3. No transaction rollback on stream failure.
4. Collector downloads and ownership assets use master paths — **unaffected**.

---

## Rollback procedure

1. **Immediate (no deploy):** Set `AUTO_GENERATE_STREAM_ASSETS=0` (or remove). With master switch off, `HYBRID_STREAMING_ENABLED=0` disables all hybrid paths.
2. **Verify:** `POST /api/admin/sync/catalog` response omits `streamAutoGenerateEnabled` and `streamResults` — behavior identical to pre–Stage 3.
3. **Code rollback (optional):** Revert Stage 3 files listed above; remove stream hook from `admin/sync/catalog/route.js`.
4. **R2 cleanup (optional):** Delete `streaming/` objects if generated during testing — masters untouched.
5. **DB cleanup (optional):** Null `stream_path` / `stream_key` on affected products — additive columns; safe to ignore.

---

## Validation results

| Check | Result |
|-------|--------|
| `npm run build` | ✅ **PASS** |
| `npm run test:foundation` | ✅ **PASS** |
| `npm run verify:foundation -- --quick` | ✅ **PASS** (guardrails 0 errors; PostHog env keys missing locally — pre-existing) |
| Prohibited files unchanged | ✅ Confirmed |
| Recovery anchor drift | ✅ **0** — operational anchor still `bac9eb7` |
| Default flags OFF behavior | ✅ No stream hook side effects when env unset |

---

## Risks introduced

| Risk | Severity | Mitigation |
|------|----------|------------|
| ffmpeg missing on Vercel/serverless | **Medium** | Failures non-blocking; log in streamResults; ops install ffmpeg or set FFMPEG_PATH on worker |
| Long sync latency when flag ON | **Medium** | Transcode is post-upsert; consider async queue in Stage 5 |
| Temp disk usage during transcode | **Low** | Temp files cleaned in finally block |
| Accidental flag enable in prod | **Low** | Both master + auto-generate must be ON; default OFF |

---

## Stages not implemented (awaiting approval)

| Stage | Scope | Status |
|-------|-------|--------|
| 4 | Resolver stream-first + master fallback | ⏸ Pending |
| 5 | Backfill transcoding queue | ⏸ Pending |
| 6 | Shadow mode / admin diagnostics | ⏸ Pending |
| 7 | Staging canary / prod rollout | ⏸ Pending |

---

## STOP — awaiting Stage 4 approval

Stage 3 is complete. **Do not proceed** to resolver changes, backfill queue, or playback routing until explicit approval.
