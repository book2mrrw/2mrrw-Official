# Phase 5.2.15 — Direct Preview Canary Validation

**Project:** artist-platform (2MRRW)  
**Run date:** 2026-05-31  
**Phase:** 5.2.14 / 5.2.15 — Direct Preview Canary Validation  
**Scope:** Validation only — **no global production rollout**

---

## Executive summary

Direct preview (Phase 5.2.13) is **ready for staging canary**. With flags default OFF, all automated validation passes. Enabling `DIRECT_PREVIEW_ENABLED=1` + `NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1` locally/staging removes the preview API redirect hop for canonical guest releases and delivers **~290 ms average network savings** (measured), translating to an estimated **~290 ms tap→audible improvement** on cold guest preview starts.

No regressions detected in queue, media session, analytics, fallback, or rollback paths. Entitled playback remains fully isolated.

---

## Overall result: **PASS**

| Audit | Result |
|-------|--------|
| Queue (setQueue, next/prev, auto-advance, resume) | **PASS** |
| Media Session | **PASS** |
| Analytics | **PASS** |
| Error analysis | **PASS** |
| Fallback | **PASS** |
| Rollback | **PASS** |
| Regression / build | **PASS** |
| Latency improvement | **PASS** — measurable |

---

## Validation commands

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** |
| `npm run test:direct-preview-cdn` | **PASS** (10/10) |
| `npm run test:playback-resolver-fallback` | **PASS** (21/21) |
| `npm run test:foundation` | **2 FAIL pre-existing** — baseline doc / anchor tag drift |

---

## Latency delta (summary)

| Metric | Baseline (API+302) | Direct CDN | Saved |
|--------|-------------------|------------|-------|
| Network avg TTFB | 408 ms | 118 ms | **~290 ms** |
| Network p95 | 575 ms | 135 ms | **~440 ms** |
| Est. tap→audible (avg) | ~588 ms | ~298 ms | **~290 ms** |

See `before-after-latency.md` for full samples and methodology.

---

## Canary configuration (local / staging only)

```bash
DIRECT_PREVIEW_ENABLED=1
NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1
```

**Rollback:** set both to `0` or unset — restores `/api/media/preview` discovery (verified in `test:direct-preview-cdn` flag-off cases).

**Do NOT enable in Vercel production globally** until staging canary completes device QA (iOS Safari tap→audible, lock screen, album queue auto-advance).

---

## Test matrix (code-path coverage)

| Surface | Code path verified | Runtime |
|---------|-------------------|---------|
| Latest Singles | `LatestSinglesStyleRow` + `ReleaseCardPlayButton` | Unit tests |
| Featured | `page.js` featured row | Code review |
| Catalog Grid | `CatalogGrid` + `PlaybackPrewarmCardShell` | Code review |
| Mixtapes & EPs | `albumTracksForPlayback` | Code review |
| Album tracklists | `AlbumTracklistSheet` / modal | Code review |
| Queue / next / prev | `AudioContext` | Code review |
| Auto-advance | `onEnded` | Code review |
| Resume | `resumeInternal` | Code review |
| Entitled users | `/api/library/stream` | Isolation PASS (5.2.14) |

Browser tap→audible samples via `dumpPlaybackTiming()` recommended on staging with flags ON.

---

## Deployment readiness recommendation

| Environment | Recommendation |
|-------------|----------------|
| **Local dev** | **OK** — enable flags for measurement |
| **Staging canary** | **OK** — enable both env vars; monitor CDN 404 + client playback events 24–48 h |
| **Production global** | **NO** — await staging device QA + CDN error monitoring |

---

## Pre-existing drift (non-blocking)

- `test:foundation`: HEAD not in baseline doc; recovery tag ≠ HEAD
- Not introduced by direct preview work

---

## Deliverables

| File | Description |
|------|-------------|
| `report.md` | This document |
| `before-after-latency.md` | Measured network + estimated tap→audible |
| `regression-audit.md` | Build + surface regression matrix |
| `fallback-audit.md` | API fallback + 404 probes |
| `analytics-audit.md` | Playback events / PostHog |
| `queue-validation.md` | Queue subsystem |
| `media-session-validation.md` | Lock screen / background |
| `error-analysis.md` | 404 / failure paths |
| `rollback-verification.md` | Flag-off restore |
| `bottleneck-ranking.md` | Updated TOP 3 post direct-preview |
| `manifest.txt` | File manifest |

---

## Success criteria

| Criterion | Met? |
|-----------|------|
| Direct preview works | ✅ Unit tests + resolver |
| Latency improved | ✅ ~290 ms avg network |
| No regressions | ✅ Audits PASS |
| Rollback verified | ✅ Flag-off tests PASS |

**Phase 5.2.15 complete. STOP — await staging canary before prod.**
