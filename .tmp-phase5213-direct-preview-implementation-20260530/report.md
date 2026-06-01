# Phase 5.2.13 — Direct Preview Activation Implementation

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Builds on:** Phase 5.2.11 (elimination analysis), Phase 5.2.12 (readiness validation)

---

## Executive summary

Direct preview CDN bypass is **implemented behind feature flags (default OFF)**. When `NEXT_PUBLIC_DIRECT_PREVIEW_CDN=1` (and/or server `DIRECT_PREVIEW_ENABLED=1`), eligible canonical previews resolve to `getPublicR2Url()` in `catalogPreviewAudioUrl` — removing the `/api/media/preview` redirect hop (~141–391 ms API TTFB + ~198 ms redirect). Discovery-only and unknown releases **continue to use** `/api/media/preview`. Entitlements, collector, library stream, queue, Media Session, analytics, and prewarm paths are unchanged (they consume resolved URL strings).

**Deployment readiness:** Code is merge-ready; **production flag ON is NOT ready** until staging canary validates CDN keys and error rates.

---

## Blockers B1–B3 — status

| ID | Requirement | Status |
|----|-------------|--------|
| **B1** | Direct CDN branch in `catalogPreviewAudioUrl` via `getPublicR2Url()` | ✅ |
| **B2** | No flat `previews/{stem}-preview.*` CDN embed; slug → nested `preview_legacy` | ✅ |
| **B3** | Discovery fallback to `/api/media/preview` when no concrete key | ✅ |

---

## Feature flags

| Variable | Scope | Default | `=1` behavior |
|----------|-------|---------|---------------|
| `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | Client + SSR | `0` / unset | Direct CDN for eligible keys |
| `DIRECT_PREVIEW_ENABLED` | Server supplement | `0` / unset | Same (SSR-only if public unset) |

Rollback: set both to `0` and redeploy — no code revert.

---

## Validation summary

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** |
| `npm run test:direct-preview-cdn` | **PASS** (10/10) |
| `npm run test:playback-resolver-fallback` | **PASS** (21/21) |
| `npm run test:foundation` | **2 FAIL** (pre-existing anchor drift — HEAD `82aeeb03` vs tag `foundation-stable-v3` `bac9eb71`) |

---

## Latency (from Phase 5.2.10/5.2.11 models)

See `latency-comparison.md`. Expected tap→first-byte improvement when flag ON: **~340 ms** (expected), **~220–340 ms** (best), **~440–590 ms** (worst vs cold API STALE).

---

## Known issues

1. **Foundation anchor drift** — unrelated to this phase; document separately for recovery checkpoint update.
2. **Prewarm cache** — may hold CDN URLs until eviction after flag rollback (low risk; same bytes).
3. **Non-canonical DB releases** — remain class **A** (API discovery only).

---

## Zip

`/Users/recharge/Downloads/phase5213-direct-preview-implementation-20260530.zip`
