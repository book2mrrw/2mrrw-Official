# Phase 5.3.5 — Production Deployment + Post-Deploy Validation

**Project:** artist-platform (2MRRW)  
**Run date:** 2026-05-31  
**Overall result:** **CONDITIONAL PASS**

---

## Executive summary

Phase 5.3.5 completes **production deployment** of Phase 5.3.4 hybrid streaming activation: commit `250e2bb` pushed to `main`, Vercel production env flags enabled, production redeployed and aliased to **https://www.2mrrw.com**.

**Stream hit rate: 97.2%** | **Fallback rate: 2.8%** (Roll Call non-blocking)

Resolver and API probes pass. Live entitled fan playback (authenticated stream HTTP + mobile queue UI) deferred to manual QA.

**Recommendation: APPROVE production hybrid activation** with follow-up entitled mobile smoke test.

---

## Deployment status

| Item | Status |
|------|--------|
| Commit `250e2bb` pushed | ✅ |
| `HYBRID_STREAMING_ENABLED=1` (Production) | ✅ |
| `STREAM_PLAYBACK_PREFERRED=1` (Production) | ✅ |
| Production deploy READY | ✅ |
| Active deployment | `dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83` |
| Production URL | https://www.2mrrw.com |

---

## Validation matrix

| Phase | Result |
|-------|--------|
| Pre-deploy check | ⚠ Working tree not clean; deploy commit isolated |
| Production config | ✅ PASS |
| Deployment | ✅ PASS (GitHub + redeploy) |
| Post-deploy API/resolver | ✅ PASS (17/17 samples, 35/36 catalog) |
| Entitlement (code + guest API) | ✅ PASS |
| Entitlement (live stream session) | ⏸ DEFERRED |
| Browser playback UI | ⏸ BLOCKED (sign-in overlay) |
| Production metrics | ✅ 97.2% / 2.8% |
| Rollback documented | ✅ PASS |

---

## Conditions (non-blocking)

1. **`01-roll-call`** — 2.8% fallback; master absent by design  
2. **Local WIP** — 10 uncommitted playback files not deployed  
3. **Entitled prod HTTP** — needs subscriber session cookie / device QA  
4. **Guest browser play** — sign-in sheet blocked automated tap test; API preview 302 verified  

---

## Rollback (summary)

```bash
cd /Users/recharge/artist-platform && printf '0' | npx vercel env add STREAM_PLAYBACK_PREFERRED production && npx vercel redeploy dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83
```

Or promote `dpl_65HN3X4LhiLUrTayJNpcQj3n3qrd`. See `rollback-instructions.md`.

---

## Approval recommendation

| Decision | Rationale |
|----------|-----------|
| **APPROVE** hybrid streaming in production | Flags live, deploy healthy, metrics match Phase 5.3.4 |
| **Follow-up** | Mobile entitled playback QA within 24h |

---

## Deliverables

| File | Description |
|------|-------------|
| `report.md` | This file |
| `pre-deploy-check.md` | Git / commit state |
| `production-config.md` | Vercel env flags |
| `deployment-record.md` | IDs, URLs, timestamps |
| `post-deploy-validation.md` | API + resolver + browser |
| `entitlement-validation.md` | User-type routing |
| `production-metrics.md` | Hit/fallback rates |
| `rollback-instructions.md` | Rollback procedures |
| `manifest.txt` | File index |

**Zip:** `/Users/recharge/Downloads/phase535-production-deployment-20260530.zip`

---

**STOP**
