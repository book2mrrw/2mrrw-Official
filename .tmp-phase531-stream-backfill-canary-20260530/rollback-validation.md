# Rollback Validation — Phase 5.3.1

**Run date:** 2026-05-31  
**Section result:** **PASS**

---

## Rollback procedure

Set env (local/staging/production):

```bash
STREAM_PLAYBACK_PREFERRED=0
# or unset HYBRID_STREAMING_ENABLED
```

**No data restore required** — stream objects and DB registration remain; resolver ignores stream branch when flags OFF.

---

## Automated proof

`npm run test:playback-resolver-fallback` — **21/21 PASS**

| Scenario | Expected | Result |
|----------|----------|--------|
| `fallback-hybrid-on-preferred-off` | Master kept, `flags_off` | PASS |
| `gate-master-kept-flags-off` | Master key unchanged | PASS |
| `gate-stream-replaces-master` (flags ON) | Stream key when registered | PASS |

---

## Post-backfill behavior

| Flags | Backfilled item playback | DB/R2 state |
|-------|--------------------------|-------------|
| OFF | Master (same as pre-hybrid) | Stream rows preserved |
| ON | Stream when HEAD hit | Unchanged |

---

## Production rollback drill

1. Set Vercel env `STREAM_PLAYBACK_PREFERRED=0`
2. Redeploy staging
3. Play `hour-glass` as entitled user → master URL in network tab
4. Re-enable for canary expansion

**Estimated recovery:** minutes (env-only)
