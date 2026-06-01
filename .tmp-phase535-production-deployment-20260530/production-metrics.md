# Production Metrics — Phase 5.3.5

**Run date:** 2026-05-31  
**Deployment:** `dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83`

---

## Stream resolver metrics (catalog)

| Metric | Expected | Actual | Match |
|--------|----------|--------|-------|
| Stream hit rate | 97.2% | **97.2%** (35/36) | YES |
| Fallback rate | 2.8% | **2.8%** (1/36) | YES |
| Sample tracklist hits | 100% | **17/17** | YES |
| Roll Call | Non-blocking | `love-hz-vol-1/01-roll-call` unregistered | OK |

---

## Fallback inventory

| Item | Reason |
|------|--------|
| `track:love-hz-vol-1/01-roll-call` | No master in R2; stream registration absent — intentional |

---

## Deployment health

| Signal | Value |
|--------|-------|
| Vercel state | READY |
| Production home TTFB | ~676ms (single probe) |
| Build time (redeploy) | ~52s |
| Failed deploy in window | None for `250e2bb` |

---

## Playback health

| Signal | Status |
|--------|--------|
| Guest preview CDN redirect | 302 — working |
| Guest stream gate | 401 without session — correct |
| Resolver fallback tests | 21/21 PASS |
| Live mobile tap→audible | **Not measured** this phase |

---

## Regressions / risks

| Item | Severity | Notes |
|------|----------|-------|
| Local uncommitted playback WIP | Low | Not deployed; avoid merging until reviewed |
| Browser sign-in overlay blocks guest play QA | Low | API preview paths verified separately |
| No prod entitled session probe | Medium | Schedule subscriber smoke on device |
| Foundation smoke drift | Low | Pre-existing; unrelated to hybrid flags |

---

## Weighted latency (estimate — unchanged from 5.3.4)

| Path | Est. tap→audible |
|------|----------------:|
| Guest preview | ~588 ms |
| Entitled stream hit | ~350 ms |
| Entitled master fallback | ~700 ms |
| Weighted catalog avg | ~340 ms |

Live production mobile timings pending entitled fan QA.
