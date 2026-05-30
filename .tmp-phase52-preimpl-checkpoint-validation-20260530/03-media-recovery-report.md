# 03 — Media Recovery Report

**Phase:** 5.2 Pre-Implementation Checkpoint Validation  
**Date:** 2026-05-30  
**Mode:** Read-only audit

---

## Verdict: **PASS**

Current production architecture is **master-only** in Cloudflare R2. All playback, preview, download, and collector paths resolve through canonical entity folders under `digital-assets/` and public `previews/`. No `streaming/` layer exists yet. **Master playback state is restorable without manual catalog rebuild.**

---

## Current media architecture (pre-Phase 5.2)

| Asset class | R2 prefix | Resolver | Signed access |
|-------------|-----------|----------|---------------|
| Full audio (masters) | `digital-assets/{singles\|features\|mixtapes-and-eps}/…` | `resolvePlaybackKey` → master path | `/api/library/stream?redirect=1` |
| Previews (guest) | `previews/…` or entity preview folders | `/api/media/preview` | Public CDN + API |
| Downloads / collector | `digital-assets/…` via `products.storage_path` | `/api/access/[token]` | R2 presigned redirect |
| Visuals / MP4 | `videos/`, `images/` | `/api/media/visual`, public `/videos/*` | Mixed public/signed |

**Phase 5.2 stream renditions:** Not implemented. No `streaming/` objects required for current playback.

---

## Reference inventory

### Canonical catalog (`src/lib/media/canonical-catalog.js`)

| Type | Releases | Tracks |
|------|----------|-------:|
| Singles | 4 | 4 |
| Features | 2 | 2 |
| Mixtapes & EPs | 3 | 30 |
| **Total** | **9** | **36** |

Each entity defines:

- `storage_path` / entity folder key
- `preview_path` or entity preview folder
- `artwork_path`, `video_path` where applicable

### DB parity

Migration `20260529120000_canonical_media_metadata.sql` seeds matching `products.storage_path`, `preview_path`, and `catalog_tracks` rows.

---

## R2 dependency chain

| Component | File | Role |
|-----------|------|------|
| R2 client / presign | `src/lib/server/r2-stream-proxy.js`, R2 lib modules | Signed GET for entitled stream |
| Key normalization | `src/lib/playback/normalize-r2-key.js` | Master key paths (not `streaming/`-aware yet) |
| Public CDN | `src/lib/storage/r2-public-cdn.js` | Preview/visual CDN URLs |
| Env vars (runtime) | `CLOUDFLARE_R2_*`, `NEXT_PUBLIC_R2_PUBLIC_URL` | Required for playback (not in recovery zip) |

**Gap:** Recovery scripts do not validate R2 object existence or bucket inventory.

---

## Signed URL dependencies

1. **Entitled playback:** `/api/library/stream` → resolves key → presigned R2 URL or proxy
2. **Download token:** `/api/access/[token]` → `buildR2Key(DIGITAL_ASSETS, storage_path)` — **master only**
3. **Vault media:** `/api/vault/media` — separate signed path flow
4. **Session recovery refresh:** `src/system/recovery/signedUrlRefresher.js` — refreshes queue URLs on tab restore

Signed URLs expire (≤55 min stream cache per Phase 4.8). Recovery re-resolves on next play — no stale permanent URLs in DB.

---

## Stream asset registrations (Phase 5.2 planned)

| Item | Current state | Readiness |
|------|---------------|-----------|
| `streaming/` R2 prefix | Not in resolver | Design in Phase 5 docs |
| Transcode pipeline | Not implemented | Phase 5.1 gap |
| `media_assets` stream roles | Schema supports assets; no stream rows | ✅ Extensible |
| `normalizePlaybackR2Key` stream awareness | Not implemented | Required for 5.2 |

**Pre-implementation:** Absence of stream layer = **clean rollback baseline**.

---

## MASTER PLAYBACK STATE restorable without catalog rebuild?

**Yes.**

| Step | Mechanism |
|------|-----------|
| 1 | Git checkout `23f77e4` or `e8402d8` restores resolver + API code |
| 2 | Migrations re-seed `products` / `catalog_tracks` if DB rebuilt |
| 3 | `canonical-catalog.js` provides offline catalog truth |
| 4 | R2 masters unchanged in bucket — no transcode dependency |
| 5 | Client recovery hydrates queue via `/api/catalog/hydrate` + stream API |

No manual slug-by-slug catalog reconstruction required if migrations + canonical JS are deployed together.

---

## Gaps (non-blocking for PASS)

1. No automated R2 inventory snapshot in recovery scripts
2. R2 object existence not verified in this audit (Phase 5.1 noted estimated inventory)
3. `normalizePlaybackR2Key` not yet `streaming/`-aware (future 5.2 work)
4. Env vars for R2 not validated in `verify:foundation` dry-run

---

## Layer 3 conclusion

| Criterion | Result |
|-----------|--------|
| Master refs in catalog + DB | ✅ |
| Playback refs via resolver + library/stream | ✅ |
| Download/collector isolated on masters | ✅ |
| Stream layer absent (clean baseline) | ✅ |
| Restorable without manual catalog rebuild | ✅ |

**Layer 3 — Media Recovery: PASS**
