# Phase 5.2.3 — Playback Metadata & Continuity Remediation

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Baseline commit:** `8997d9e` (Phase 5.2.1 queue fix, unchanged HEAD)  
**Mode:** Targeted defect remediation (D-522-001, D-522-002 only)  
**Zip:** `/Users/recharge/Downloads/phase523-metadata-remediation-20260530.zip`

---

## Executive summary

Two defects from the Phase 5.2.2 audit are remediated:

1. **D-522-001 (BLOCKING):** `mergeCanonicalMetadata` no longer overwrites per-track titles when the item is an album/EP/mixtape track (`album_track`, `trackSlug`, or `metadata.trackSlug`). Queue objects, now-playing metadata, and MediaSession inputs receive canonical track titles.
2. **D-522-002 (MEDIUM):** `closeAlbumModal` and `closeSingleModal` no longer call `pause()` — modal dismiss matches `AlbumTracklistSheet` continuity (playback continues with global bar).

`AudioContext.js`, playback resolver, stream/hybrid architecture, and entitlement systems were not modified.

---

## Root causes

### D-522-001

`resolveAlbumTrackPlaybackItem` correctly set `title` from `getCanonicalTrack`, then `normalizeCatalogItemForPlayback` → `mergeCanonicalMetadata` resolved `item.slug` as the **release stream slug** (`ad`, `love-hz-vol-1`, etc.) and unconditionally assigned `title` / `display_title` from the release record.

### D-522-002

`closeAlbumModal` and `closeSingleModal` in `src/app/page.js` called `pause()` on every dismiss, stopping active queue playback. `AlbumTracklistSheet` `onClose` already left playback running.

---

## Files modified

| File | Change |
|------|--------|
| `src/lib/media/canonical-catalog.js` | `mergeCanonicalMetadata`: detect album tracks; preserve `title` / `display_title` when track-level metadata present |
| `src/app/page.js` | Remove `pause()` from `closeAlbumModal`, `closeSingleModal` |

**Not modified (per scope):** `AudioContext.js`, `resolve-playback-key.js`, `resolve-stream-playback.js`, entitlement/audiovisual modules.

---

## Validation

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm run test:foundation` | **2 pre-existing FAIL** (HEAD vs `foundation-stable-v3` anchor drift — unchanged, not playback-related) |
| Static title audit (`validate-metadata.mjs`) | **PASS** — Love Hz, A.D, T.B.H tracks 1/3/5/7/last retain canonical titles in `mapAlbumTracksForPlayback` + playable queue |
| Singles metadata | **PASS** — `normalizeCatalogItemForPlayback({ slug: 'w2d' })` still merges release metadata |
| Album track sample | **PASS** — `ad` track `01-2mrrws-ntro` → `"2mrrw's Ntro"` after normalize |
| Modal close continuity | **PASS** (code) — `closeAlbumModal` / `closeSingleModal` clear UI state only; no `pause()` |

**Script:** `node --import ./scripts/register-alias.mjs .tmp-phase523-metadata-remediation-20260530/validate-metadata.mjs`

**Browser / entitled streaming:** Not re-run in this phase (same limitation as 5.2.2). Recommend spot-check on device after deploy.

---

## Rollback

```bash
git checkout 8997d9e -- src/lib/media/canonical-catalog.js src/app/page.js
```

Or revert the two-file diff on current branch. No schema, env, or migration changes.

---

## Production readiness

### **READY**

For the scoped remediation (multi-track title/metadata + modal-close continuity). Queue index behavior from 5.2.1 remains intact. Residual items D-522-003 through D-522-005 from 5.2.2 remain informational and were out of scope.

**Do not activate Phase 5.3** unless the parent workflow explicitly requests it — this deliverable ends at 5.2.3.

---

## STOP

Remediation complete. No commit, push, or deploy performed.
