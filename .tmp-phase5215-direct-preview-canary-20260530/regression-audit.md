# Regression Audit — Phase 5.2.15 Direct Preview Canary

**Run date:** 2026-05-31  
**Scope:** Code-path + automated test validation (no prod flag rollout)

---

## Automated test matrix

| Command | Result | Notes |
|---------|--------|-------|
| `npm run build` | **PASS** | Next.js 16.2.4 compile OK; `/api/media/preview` still in route table |
| `npm run test:direct-preview-cdn` | **PASS** | 10/10 scenarios |
| `npm run test:playback-resolver-fallback` | **PASS** | 21/21 scenarios |
| `npm run test:foundation` | **2 FAIL (pre-existing)** | HEAD vs baseline doc; tag `foundation-stable-v3` ≠ HEAD — not introduced by direct preview |

---

## Playback surface code-path audit

| Surface | File(s) | Preview resolution | Regression risk |
|---------|---------|-------------------|-----------------|
| Latest Singles | `LatestSinglesStyleRow.js`, `ReleaseCardPlayButton.js` | `catalogPreviewAudioUrl` | **LOW** — URL string change only |
| Featured | `page.js` featured row | Same | **LOW** |
| Catalog Grid | `CatalogGrid.js` + `PlaybackPrewarmCardShell` | Prewarm + play button | **LOW** — cache holds CDN URL when flag ON |
| Mixtapes & EPs | `albumTracksForPlayback` | Per-track `resolvePlaybackSrc` | **LOW** |
| Album tracklists | `AlbumTracklistSheet.js`, `page.js` modal | Queue build | **LOW** |
| Queue nav | `AudioContext` setQueue/playNext/playPrevious | Uses pre-built `track.src` | **NONE** |
| Auto-advance | `onEnded` handler | Next queued track | **NONE** — benefits from CDN per track |
| Resume | `resumeInternal` | Existing `audio.src` | **NONE** |
| Entitled playback | `resolvePlaybackSrc` → `/api/library/stream` | Never calls `isDirectPreviewCdnEnabled` | **NONE** |

Phase 5.2.14 unified entitlement validation: **PASS** — direct preview isolated to guest preview path.

---

## Entitlement isolation (re-verified)

| User type | Direct preview affects play? |
|-----------|------------------------------|
| Guest | Yes — preview may skip API |
| Subscriber | No — stream redirect |
| Collector / purchase owner | No |
| Admin | No |

---

## UI / UX regressions

| Check | Result |
|-------|--------|
| Cinematic shell / layout | **PASS** — no UI files changed in canary validation |
| Play button states | **PASS** — `getPlayButtonState` path-based, not API-host-based |
| Double `<audio>` element | **PASS** — single element in `AudioContext` |
| CS (chopped & slowed) mode | **PASS** — separate asset path, unaffected |

---

## Build / route regressions

| Check | Result |
|-------|--------|
| `/api/media/preview` retained | **PASS** |
| `/api/library/stream` unchanged | **PASS** |
| Feature flags default OFF | **PASS** — `isDirectPreviewCdnEnabled()` false without env |

---

## Pre-existing foundation drift (document separately)

1. `FRONTEND_FOUNDATION_BASELINE.md` does not document current HEAD `82aeeb03…`
2. Operational anchor tag `foundation-stable-v3` (`bac9eb71…`) ≠ HEAD

**Not blocking** direct preview staging canary.

---

## Overall regression audit

**PASS** — No regressions detected in automated suite or code-path review. Entitled playback and queue semantics unchanged.
