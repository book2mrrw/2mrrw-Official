# 12 — Readiness Score

**Phase 5.1 hybrid master/stream migration readiness assessment.**  
**Date:** 2026-05-30

---

## Scoring methodology

Each dimension scored 0–100. Weights reflect migration dependency order.

| Dimension | Weight | Description |
|-----------|-------:|-------------|
| Architecture | 30% | Design completeness, R2 layout, path alignment |
| Migration | 25% | Rollout plan, rollback, backfill readiness |
| Playback | 25% | Client compat, mobile, Phase 4.x lock |
| Operational | 20% | Admin workflow, transcode infra, runbooks |

**Total = weighted sum, rounded to integer.**

---

## Subscores

### Architecture — 88/100

| Criterion | Score | Notes |
|-----------|------:|-------|
| R2 layout defined | 95 | `streaming/` mirrors `canonical-paths.js` |
| Master/stream separation | 95 | Orthogonal prefixes validated |
| Entitlement plane unchanged | 100 | No schema change required MVP |
| Code extension points identified | 80 | `normalizePlaybackR2Key` gap documented |
| Live R2 census | 60 | Not run — estimates only |
| Phase 5 design consumed | 95 | `.tmp-phase5-hybrid-architecture-20260530/` |

**Architecture subscore:** **88**

---

### Migration — 74/100

| Criterion | Score | Notes |
|-----------|------:|-------|
| Non-destructive plan | 95 | Masters preserved; additive only |
| Rollback plan | 90 | Env flag + master fallback |
| Phased gates | 85 | 5a–5e defined |
| Transcode infrastructure | 40 | **Not built** |
| Backfill automation | 45 | FFmpeg spec only |
| Shadow mode design | 80 | Diagnostics pattern exists |
| Timeline realism | 75 | 6-week illustrative |

**Migration subscore:** **74**

---

### Playback — 86/100

| Criterion | Score | Notes |
|-----------|------:|-------|
| Client contract unchanged | 100 | `redirect=1`, single `<audio>` |
| AAC format compat | 95 | iOS/Android native |
| Phase 4.8 lock preserved | 90 | Caches + Server-Timing |
| Media Session / background | 90 | No format blocker |
| Measured entitled 200 | 50 | **Pending** prod validation |
| Mobile tap→audible | 75 | Projection only; 4.7 gaps |

**Playback subscore:** **86**

---

### Operational — 71/100

| Criterion | Score | Notes |
|-----------|------:|-------|
| Current admin sync works | 90 | No breaking change |
| Ops runbook | 40 | Not written |
| Diagnostics extensibility | 75 | `admin-media-diagnostics.js` |
| Upload automation | 50 | Manual R2 + sync today |
| Cost model | 80 | Projections documented |
| Collector/download isolation | 95 | Token route verified |

**Operational subscore:** **71**

---

## Total readiness score

```
Total = (88 × 0.30) + (74 × 0.25) + (86 × 0.25) + (71 × 0.20)
      = 26.4 + 18.5 + 21.5 + 14.2
      = 80.6
      ≈ 81/100
```

| Dimension | Score | Weight | Weighted |
|-----------|------:|-------:|---------:|
| Architecture | 88 | 30% | 26.4 |
| Migration | 74 | 25% | 18.5 |
| Playback | 86 | 25% | 21.5 |
| Operational | 71 | 20% | 14.2 |
| **Total** | | | **81** |

---

## Score interpretation

| Range | Meaning |
|-------|---------|
| 90–100 | Ready for immediate prod rollout |
| **75–89** | **Conditional GO — proceed to implementation with gates** |
| 60–74 | Design OK; block prod until infra gaps closed |
| <60 | Not ready — redesign or more discovery |

---

## Gates to reach 90+ (before prod canary)

| Gate | Points unlocked | Owner |
|------|-----------------|-------|
| R2 live inventory script run | +3 architecture | Ops |
| Transcode worker operational | +8 migration | Eng |
| Ops runbook published | +5 operational | Ops |
| Staging entitled 200 + HAR | +5 playback | QA |
| Stream URL cache key hash fix | +2 migration | Eng |

**Estimated post-gates score:** ~89–92

---

## Go / No-Go matrix

| Decision | Threshold | Current |
|----------|-----------|---------|
| **Design approval (5a→5b)** | ≥75 | **81 ✅** |
| **Staging flip (5c)** | ≥85 + transcode 95% | 81 ⏸ |
| **Prod canary (5d)** | ≥90 + QA matrix pass | ⏸ |

---

## Recommendation

**Conditional GO** for Phase **5b (Ingest)** and **5c (Resolver)** implementation.  
**No-GO** for production canary until transcode backfill ≥95% and staging validation complete.
