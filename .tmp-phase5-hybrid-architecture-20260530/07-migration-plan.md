# 07 — Migration Plan (Non-Destructive Rollout)

**Principle:** Additive only — no master deletes, no schema breaking changes in Phase 5a.

---

## Phase gates

| Gate | Scope | Exit criteria |
|------|-------|---------------|
| **5a — Design** | This document set | Stakeholder sign-off |
| **5b — Ingest** | Transcode + R2 upload | 95% catalog entities have `.m4a` |
| **5c — Resolver** | `resolvePlaybackKey` stream-first | Staging entitled play HAR OK |
| **5d — Prod** | Feature flag `STREAM_PLAYBACK_PREFERRED=1` | p95 tap→audible ≤ target |
| **5e — HLS** | Optional adaptive | iOS validation only |

---

## Rollout steps

### Step 1 — Convention & inventory (week 0)

- Document all entity folders with masters (script: list R2 `digital-assets/` prefixes).
- Map to `products.slug` via `storage_path`.
- **No production behavior change.**

### Step 2 — Transcode backfill (week 1–3)

- Batch FFmpeg jobs per entity folder.
- Write `streaming/…/{slug}.m4a` with `faststart`.
- Verify duration ± 50 ms vs master.
- **Masters untouched.**

### Step 3 — Metadata linkage (week 2)

- Optional: insert `media_assets` rows `asset_role: stream_audio`.
- Admin sync accepts `stream_path` in metadata (future `admin/sync/catalog` extension).
- **Backward compatible:** resolver discovers by folder if DB row missing.

### Step 4 — Shadow mode (week 3)

- Resolver computes stream key but **does not use** (log-only).
- Compare stream vs master key resolution in diagnostics route (`admin/media-diagnostics` pattern).

### Step 5 — Staging flip (week 4)

- Env `STREAM_PLAYBACK_PREFERRED=1` on staging.
- Run Phase 4.7 validation matrix (entitled 200, preview, iOS marks).
- Server-Timing: confirm `cdn` segment byte size drop.

### Step 6 — Production canary (week 5)

- 10% traffic or allowlist slugs (hour-glass, love-hz-vol-1).
- Monitor 422/404 `MEDIA_UNAVAILABLE` rate.
- Roll forward or rollback via env flag (see `08-rollback-plan.md`).

### Step 7 — Full catalog (week 6+)

- 100% slugs on stream-first.
- Deprecate master-for-playback in ops docs (masters remain for download).

---

## Compatibility matrix

| Client | Compat |
|--------|--------|
| iOS Safari current prod | Yes — AAC in MP4 |
| Older cached `audio.src` | New play resolves fresh key |
| Offline cache | Re-cache stream file on next online play |
| Admin sync old rows | Master path still valid |

---

## Dual-read period

Minimum **90 days** where:

- Playback prefers stream if present.
- Master always present for download/token routes.
- Ops may upload new masters without stream; fan hears master fallback (degraded perf, not outage).

---

## Catalog-specific notes

| Release type | Path nuance |
|--------------|-------------|
| Singles | `streaming/singles/{slug}/{slug}.m4a` |
| Features | Often WAV preview today — stream still AAC |
| Albums | Per-track stream under `streaming/albums/{album}/{track}/` |
| Mixtapes/EPs | Same nested rules as `canonical-paths.js` |

---

## Validation (from Phase 4.7 P0)

1. `dumpPlaybackTiming()` localhost — entitled redirect + preview iOS width.
2. Prod HAR + session cookie — 200 stream TTFB + Server-Timing.
3. Compare CDN first-byte before/after on same slug.

---

## Out of scope for migration

- Supabase Storage cutover
- UI / cinematic changes
- Entitlement schema redesign
- Dependency bumps
