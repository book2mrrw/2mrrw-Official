# 06 — Recommended Fixes

**Not implemented in Phase 4.7** (analysis only). Ordered by impact/risk. Aligns with Phase 4.5 remediation plan; defers architecture changes unless noted.

## P0 — Validation (no prod code)

| # | Action | Expected insight |
|---|--------|------------------|
| V1 | Localhost dev: capture `dumpPlaybackTiming()` for preview + entitled redirect on iOS 375px | Fill 9 pending browser marks |
| V2 | HAR: entitled play with session cookie on prod/staging | Measure 200 stream TTFB + byte start |
| V3 | Compare `redirect=1` vs JSON refresh on same slug | Quantify HEAD penalty |

## P1 — Server / network (backend-safe)

| # | Fix | Files | Gain | Risk |
|---|-----|-------|------|------|
| S1 | Add `Server-Timing` on `library/stream` (auth, entitlement, resolve, sign, proxy) | `route.js` | Isolate server segments | Low |
| S2 | Warm `resolvePlaybackKey` / signed URL cache (60s TTL exists) — verify hit rate | `entity-resolver.js`, `stream-url-cache.js` | −100–400 ms cold | Low |
| S3 | Ensure catalog emits direct preview CDN URLs where possible | catalog API / `music-access.js` | −500 ms preview API hop | Low–med data |

## P2 — Client playback (playback-scoped)

| # | Fix | Files | Gain | Risk |
|---|-----|-------|------|------|
| C1 | Visibility refresh: prefer `redirect=1` over JSON+HEAD | `AudioContext.js`, `stream-client.js` | −50–200 ms | Med — test entitlement |
| C2 | Defer `preloadCoverImage` until after `canplay` on mobile | `AudioContext.js` | Less bandwidth contention | Low |
| C3 | Sampled RUM: `playback-tap-to-audible` in staging | telemetry module | Prod regression guard | Low |

## P3 — Observability

| # | Fix | Notes |
|---|-----|-------|
| O1 | Dev-only mark on redirect stream request start (client) | Restores gap in dev tables without prod noise |
| O2 | Document `window.dumpPlaybackTiming` in QA playbook | Uses existing `performanceMarks.js` |

## Explicitly out of scope (per guardrails)

- Playback command queue redesign
- Second `<audio>` element
- Entitlement client overrides
- Cinematic / page.js visual changes
- Dependency bumps

## Phase 4.6 items already landed (context)

- AudioContext progress decoupling (fewer commits during play — helps tap responsiveness under load, not API TTFB)
- Hero preload metadata, tab fetch deferral, mobile ambient blur reduction

Do not re-implement; validate playback marks after those changes in V1.
