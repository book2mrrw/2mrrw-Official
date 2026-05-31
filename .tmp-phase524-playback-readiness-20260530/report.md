# Phase 5.2.4 — Playback Readiness & Unexpected Refresh Audit

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Mode:** Audit only — **no implementation, no flag activation**  
**Zip:** `/Users/recharge/Downloads/phase524-playback-readiness-20260530.zip`

---

## Executive summary

This audit traces tap→audible latency, initialization gates, and every refresh/reload mechanism against three fan reports: delayed tap-to-audio, controls feeling dead until init, and occasional full refreshes.

**Production API latency improved materially** vs Phase 4.7 (preview ~215 ms vs 602 ms; stream redirect ~174–192 ms vs 513–804 ms). Remaining perceived delay is dominated by **client audio readiness (`waitAudioSrcReady`)**, **optional cross-track fade (~300 ms)**, and **boot hydration** (`AppAuthRoot` unmounts the entire tree including `AudioProvider` until the first client effect). **No `location.reload()`** exists in app source; unexpected refreshes are **not explained by an in-repo reload loop** — investigate deploys, iOS tab lifecycle, and explicit `window.location` navigations.

**Hybrid flags (5.3):** Projected **[P]** benefit for entitled playback only after stream assets + backfill; **no activation** in this phase. Phase 5.3A prerequisites remain incomplete.

**Workspace note:** Pre-existing unstaged edits in `src/app/page.js` and `src/lib/media/canonical-catalog.js` were present before/after this audit; this pass did **not** modify `src/`.

---

## Top 3 bottlenecks (ranked)

1. **Client audio pipeline (`waitAudioSrcReady` + decode + `play()`)** — Waits for `canplay` (up to 12 s timeout); typically largest share of tap→audible after recent API improvements. First-listen volume swell adds up to ~3 s on first play per slug.

2. **Network: stream/preview API + CDN first byte** — **[M]** prod ~170–580 ms API (guest/unauth) + ~180 ms CDN range TTFB; entitled 200 path with resolve/sign/proxy **not measured** this session. JSON stream path adds **HEAD** validation RTT vs `redirect=1`.

3. **Initialization & command serialization** — `AppAuthRoot` blocks mounting `AudioProvider` until hydration; ~2873-line `page.js` inflates TTI; serial playback command queue + up to **~300 ms** cross-track fade before `loadAudioSrcAndPlay`.

---

## User issues — verdict

| Report | Verdict |
|--------|---------|
| Tap-to-audio feels delayed | **Confirmed** — server faster on prod; client decode + pre-src work still dominate |
| Controls until page init | **Partially confirmed** — hydration gate removes player entirely briefly; auth `loading` does not hard-block `playTrack` |
| Site occasionally refreshes | **No in-app reload loop** — one `router.refresh` (OTP), explicit `window.location` navigations; consider deploy/iOS/SW |

---

## Refresh findings (summary)

- **`location.reload`:** none in `src/`
- **`router.refresh`:** `verify-otp` only (expected)
- **`visibilitychange`:** audio resume, carousel videos, data resync — **no reload**
- **Auth `TOKEN_REFRESHED`:** ignored — no cascade
- **Service worker:** keep-alive only; `skipWaiting` without `controllerchange` reload handler
- **Unexpected refresh hypothesis:** Vercel deploy, iOS discard, guest `postAuthRedirect` navigation, fan hard refresh — **not** a grep-discoverable loop

Detail: `refresh-path-audit.md`

---

## Prior work consumed

| Phase | Used for |
|-------|----------|
| 4.7 / 4.8 | Latency baselines, redirect fast path, Server-Timing design |
| 5.2.1 / 5.2.2 | Queue/index validation; metadata defect still open |
| 5.3A | Flag defaults OFF, activation blockers |
| 5.2 Stage 7 | Flags-off zero delta, hybrid projections |

---

## Recommended next phase (not 5.3 activation)

1. **[M]** Entitled stream 200 + `Server-Timing` on prod/staging with session cookie  
2. **[M]** iOS 375px `dumpPlaybackTiming` on localhost (dev marks)  
3. **Init experiment (scoped):** measure TTI; evaluate mounting audio outside `AppAuthRoot` placeholder  
4. **Fix D-522-001** (album track titles) before continuity/5.3 sign-off  
5. **RUM:** `performance.navigation.type` to validate “unexpected refresh”  
6. **Hybrid:** staging backfill → canary `PREFERRED=1` only after P0–P5  

---

## Deliverables

| File | Purpose |
|------|---------|
| `report.md` | This summary |
| `playback-readiness-audit.md` | Tap→audible timeline + curl |
| `initialization-audit.md` | Hydration / auth / controls |
| `refresh-path-audit.md` | All refresh mechanisms |
| `hybrid-readiness-assessment.md` | Flags vs latency [M]/[P] |
| `curl-measurements.txt` | Raw prod probes |
| `manifest.txt` | Artifact index |

---

## STOP

**Do not activate Phase 5.3 hybrid flags** as part of 5.2.4. Operator activation sequence remains in Phase 5.3A docs only.
