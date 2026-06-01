# Post-Deploy Validation — Phase 5.3.5

**Production URL:** https://www.2mrrw.com  
**Deployment:** `dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83`  
**Commit:** `250e2bb`  
**Run date:** 2026-05-31

---

## Production API probes (guest / unauthenticated)

| Probe | Expected | Actual | Status |
|-------|----------|--------|--------|
| `GET /` | 200 | 200 (~676ms) | PASS |
| `GET /api/catalog/hydrate` | 200 | 200 | PASS |
| `GET /api/account/state` | guest null user | `user: null`, `subscriberActive: false` | PASS |
| `GET /api/library/stream?slug=ad&trackSlug=03-said-n-done` | auth/entitlement gate | **401** Unauthorized | PASS (auth before stream) |
| `GET /api/library/stream?slug=hour-glass` | auth gate | **401** | PASS |
| `GET /api/media/preview?legacy=previews/singles/hour-glass/hourglass-preview.mp3` | 302 CDN | **302** | PASS |
| `GET /api/media/preview?folder=singles/hour-glass&legacy=...` | 302 | **302** | PASS |
| `GET /api/media/preview?folder=features/2-heavy&legacy=...` | 302 | **302** | PASS |
| `GET /api/media/preview?folder=albums/ad&legacy=previews/03-said-n-done-preview.wav` | 302 | **302** | PASS |

---

## Resolver validation (DB + R2 — same backend as production)

**Script:** `scripts/phase534-tracklist-validation.mjs`  
**Flags:** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`

| Surface | Tracks sampled | Stream hits | Fallbacks | Status |
|---------|----------------|-------------|-----------|--------|
| Latest Singles | hour-glass, artificial | 2/2 | 0 | PASS |
| Features | 2-heavy, i-dont-believe-you | 2/2 | 0 | PASS |
| ad | 1, 3, 5, 7 (last in script) | 4/4 | 0 | PASS |
| love-hz-vol-1 | 2, 5, 7, 9 | 4/4 | 0 | PASS |
| tbh | 3, 5, 8, 9 (last) | 4/4 | 0 | PASS |
| **Total** | **17** | **17** | **0** | **PASS** |

Pipeline per track: **Track Selection → Queue (resolver input) → Asset (stream_key) → Stream (R2) → Playback Resolution (`playbackSource: stream`)**

---

## Full catalog metrics (re-run)

**Script:** `scripts/phase533-full-catalog-validation.mjs`

| Metric | Value |
|--------|------:|
| Playable items | 36 |
| Stream resolver hits | 35 |
| Fallbacks | 1 (`love-hz-vol-1/01-roll-call`) |
| Hit rate | **97.2%** |
| Fallback rate | **2.8%** |

Roll Call: master absent by design — **non-blocking**.

---

## Browser validation (production)

| Test | Result | Notes |
|------|--------|-------|
| Home load | PASS | Latest Singles, Features, Mixtapes & EPs visible |
| Guest Play preview click | **BLOCKED** | Sign-in sheet intercepts tap (mobile join flow) |
| Play / pause / resume / next / prev UI | **NOT RUN** | Requires manual fan session or E2E cookie |

**Recommendation:** Run mobile entitled QA with subscriber/collector account (tap→audible, queue advance).

---

## Automated rollback safety

`npm run test:playback-resolver-fallback` — **21/21 PASS** (post-deploy, local).

---

## Post-deploy verdict

| Category | Status |
|----------|--------|
| API + resolver samples | **PASS** |
| Catalog coverage | **PASS** (97.2%, Roll Call exempt) |
| Live guest playback UI | **DEFERRED** (sign-in overlay) |
| Live entitled stream HTTP | **DEFERRED** (no session cookie in run) |

**Overall post-deploy:** **CONDITIONAL PASS**
