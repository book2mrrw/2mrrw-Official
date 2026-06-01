# Rollback Verification — Phase 5.3.3

---

## Rollback mechanism

Setting **`STREAM_PLAYBACK_PREFERRED=0`** (or unset) forces all entitled playback through master WAV keys regardless of stream registration. Stream objects and DB columns remain in place but are not selected by the resolver gate.

No data restore required. Masters in `digital-assets/` were never modified.

---

## Automated verification

| Test | Result |
|------|--------|
| `npm run test:playback-resolver-fallback` | **PASS — 21/21** |

Key scenarios:

| Scenario | Expected | Result |
|----------|----------|--------|
| `flags-hybrid-on-preferred-off` | Stream not preferred | PASS |
| `gate-master-kept-flags-off` | Master used when preferred off | PASS |
| `fallback-hybrid-on-preferred-off` | Master fallback | PASS |
| `gate-master-kept-on-r2-miss` | Master on R2 miss | PASS |

---

## Production state

| Setting | Current production | Phase 5.3.3 run |
|---------|-------------------|-----------------|
| `HYBRID_STREAMING_ENABLED` | **0** (default) | 1 (CLI `--yes` only) |
| `STREAM_PLAYBACK_PREFERRED` | **0** (default) | 1 (validation script only) |
| `AUTO_GENERATE_STREAM_ASSETS` | **0** (default) | 1 (CLI `--yes` only) |

**Effective production behavior: unchanged** — all playback uses masters.

---

## Rollback procedure (if needed after flag enablement)

1. Set `STREAM_PLAYBACK_PREFERRED=0` in Vercel env
2. Redeploy (or env refresh)
3. Confirm entitled playback uses masters via staging tap test
4. Stream objects in R2 and DB registrations can remain for future re-enablement

No rollback of R2 stream objects or Supabase columns is required or recommended.
