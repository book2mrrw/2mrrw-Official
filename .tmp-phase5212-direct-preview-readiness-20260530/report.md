# Phase 5.2.12 — Direct Preview Activation Readiness Validation

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Scope:** Read-only validation — no `src/` changes  
**Builds on:** Phase 5.2.11 (`.tmp-phase5211-preview-elimination-20260530/`)

---

## Executive summary

**Can direct CDN preview replace `/api/media/preview` redirect without regressions?**

| Scope | Verdict |
|-------|---------|
| **Canonical storefront catalog** (concrete `preview_legacy` keys) | **Yes** — same bytes as API 302; ~140–390 ms tap→first-byte gain |
| **Full catalog / discovery-only releases** | **No** — folder-only paths still need API (or server hydrate) |
| **Entitled playback** | **Unchanged** — `/api/library/stream` only |

Partial direct-CDN activation is **architecturally sound** when implemented at the single resolver (`catalogPreviewAudioUrl`) with **mandatory API fallback** for non-concrete keys. Queue, Media Session, analytics, audio continuity, and prewarm all consume **resolved URL strings** — they do not depend on the redirect hop.

---

## Authorization decision

# **DIRECT PREVIEW ACTIVATION AUTHORIZED**

**Activation model:** Partial bypass for canonical/concrete preview keys; retain `/api/media/preview` for discovery, artwork/video discovery, and folder-only DB rows.

**Blockers before production flag ON:** **3** (implementation prerequisites — see below)

**Not in scope for this authorization:** Full API removal, entitlement changes, analytics pipeline changes, UI changes.

---

## Pre-activation blockers (remediation before `DIRECT_PREVIEW_ENABLED=1`)

| ID | Blocker | Severity | Remediation |
|----|---------|----------|-------------|
| **B1** | No direct-CDN branch in `catalogPreviewAudioUrl` yet | Required | Add concrete-key → `getPublicR2Url()` behind `DIRECT_PREVIEW_ENABLED` / `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` |
| **B2** | Flat legacy CDN keys 404 at edge | Required | Never embed flat `previews/{stem}-preview.*`; map slug → `preview_legacy` (Phase 5.2.10) |
| **B3** | Discovery-only releases (folder `preview_path`, no concrete key) | Required | Keep `previewDiscoveryUrl()` fallback when flag on |

**Hard regression blockers:** **0** — no veto on partial activation design.

---

## Section results (PASS/FAIL)

| # | Section | Result |
|---|---------|--------|
| 1 | Queue (`setQueue`, next/prev, auto-advance, resume) | **PASS** |
| 2 | Media Session (lock screen, background, car) | **PASS** |
| 3 | Analytics (play counts / preview API) | **PASS** |
| 4 | Audio continuity (play/pause/seek/skip/advance) | **PASS** (1 minor heuristic note) |
| 5 | Prewarm (`PlaybackPrewarmCache`, hook, shell) | **PASS** |
| 6 | Fallback (missing asset, invalid CDN, mismatch) | **PASS** (API route retained) |
| 7 | Rollback (`DIRECT_PREVIEW_ENABLED=0`) | **PASS** (feasible, not implemented) |

---

## Surface classification summary

| Surface | Class | Notes |
|---------|-------|-------|
| Latest Singles | **B** (direct CDN when keyed) | `LatestSinglesStyleRow` → `resolvePlaybackSrc` / prewarm |
| Featured | **B** | Same row + modal via `playCanonicalCatalogItem` |
| Catalog Grid (albums) | **B** | First-track via `albumCardPlaybackItem` |
| Mixtapes & EPs | **B** | Same grid/row patterns |
| Albums (modal / multi-track) | **B** / **A** per track | Canonical tracks **B**; folder-only track **A** |
| Album Tracklists | **B** / **A** | `albumTracksForPlayback` → same resolver |
| Search Results | **B** | UI filter only; same card components |
| Queue / auto-advance / prev-next | **B** / **A** | Uses queued `track.src` from resolver |
| Resume | **B** / **A** | Reuses current `src`; stream refresh separate |
| Entitled / library | **N/A** | `/api/library/stream` — not preview API |

**A** = requires preview API (discovery / non-concrete key)  
**B** = can use direct CDN (concrete `preview_legacy` or `isConcreteMediaKey`)

---

## Expected gain (from Phase 5.2.10 / 5.2.11)

| Case | Δ vs status quo |
|------|-----------------|
| Best (Vercel HIT + warm CDN) | ~**340 ms** tap→CDN first byte |
| Expected | ~**340 ms** |
| Worst (STALE/MISS + cold CDN) | ~**470–590 ms** |

---

## Deliverables

See `manifest.txt`. Zip: `/Users/recharge/Downloads/phase5212-direct-preview-readiness-20260530.zip`

---

## Validation checklist

| Check | Result |
|-------|--------|
| Phase 5.2.11 incorporated | ✅ |
| `music-access.js`, `media-urls.js`, `canonical-paths.js`, `stream-client.js` | ✅ |
| `page.js`, `LatestSinglesStyleRow`, `CatalogGrid`, `AlbumTracklistSheet`, `ReleaseCardPlayButton` | ✅ |
| `playback-prewarm-cache.js`, `AudioContext` (MediaSession, queue) | ✅ |
| `api/media/preview/route.js` | ✅ |
| No src changes | ✅ |

**STOP** — Phase 5.2.12 validation complete. Proceed to implementation only with B1–B3 remediated.
