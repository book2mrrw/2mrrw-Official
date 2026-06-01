# Activation Summary — Phase 5.3 Hybrid Streaming Canary

**Run date:** 2026-05-31  
**Activation mode:** Local / staging documentation only — **no Vercel production env changes**

---

## Flag inventory

| Env var | Default | Canary value | Gating |
|---------|---------|--------------|--------|
| `HYBRID_STREAMING_ENABLED` | OFF | `1` | Master switch for all hybrid paths |
| `STREAM_PLAYBACK_PREFERRED` | OFF | `1` | Requires HYBRID=1; stream-first in `resolvePlaybackKey` |
| `AUTO_GENERATE_STREAM_ASSETS` | OFF | `1` | Requires HYBRID=1; upload transcode + backfill CLI |

**Source:** `src/lib/feature-flags/hybrid-streaming.js`

All flags parse truthy as `"1"` or `"true"` (case-insensitive). Unset = OFF.

---

## Direct preview flags (keep OFF for hybrid-only canary)

| Env var | Recommended | Reason |
|---------|-------------|--------|
| `DIRECT_PREVIEW_ENABLED` | **OFF** | Isolates entitled-path measurement |
| `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | **OFF** | Guest preview unchanged during hybrid canary |

Direct preview and hybrid streaming are independent. Phase 5.2.15 direct preview canary passed separately.

---

## Recommended activation sequence (staging)

### Phase A — Prerequisites (operator)

1. Confirm Supabase migration applied ✅ (verified 2026-05-31 — columns exist)
2. Confirm ffmpeg available on backfill host
3. Confirm R2 credentials in staging env

### Phase B — Asset generation (before STREAM_PLAYBACK_PREFERRED=1)

```bash
# Dry-run review
npm run backfill:stream-assets -- --dry-run

# Limited live backfill (start small)
HYBRID_STREAMING_ENABLED=1 AUTO_GENERATE_STREAM_ASSETS=1 \
  npm run backfill:stream-assets -- --yes --limit 5

# Verify R2 streaming/ objects + DB stream_key populated
```

**Dry-run result (2026-05-31):** 6 products + 30 catalog_tracks = **36 candidates**, 0 currently registered.

### Phase C — Staging canary flags

```bash
HYBRID_STREAMING_ENABLED=1
STREAM_PLAYBACK_PREFERRED=1
AUTO_GENERATE_STREAM_ASSETS=1   # optional if backfill complete
```

Redeploy staging. Monitor:

- `X-Playback-Resolver` header (`result: stream` vs `master`)
- `streamFallbackReason` (`no_stream_registration`, `r2_missing`)
- Server-Timing segments on `/api/library/stream`

### Phase D — Validation checklist

- [ ] Entitled tap→audible on iOS Safari (hour-glass single)
- [ ] Album queue auto-advance with stream AAC
- [ ] Lock screen metadata + skip
- [ ] Guest preview unchanged (still preview CDN/API)
- [ ] Collector offline download still serves blob master
- [ ] Rollback drill: `STREAM_PLAYBACK_PREFERRED=0` → master confirmed

---

## Partial enablement states (safe staging)

| HYBRID | PREFERRED | AUTO | Upload transcode | Playback | Use case |
|--------|-----------|------|------------------|----------|----------|
| 0 | 0 | 0 | Off | Master only | **Current prod default** |
| 1 | 0 | 1 | On | Master only | Generate assets without serving streams |
| 1 | 1 | 0 | Off | Stream-first + fallback | **Canary target** (requires pre-backfilled assets) |
| 1 | 1 | 1 | On | Stream-first + fallback | Full hybrid |

---

## What activates on flag ON

| Subsystem | File | Behavior |
|-----------|------|----------|
| Resolver stream gate | `resolve-playback-key.js` L250–261 | `tryResolveStreamPlaybackKey` after master discovery |
| Stream candidate lookup | `resolve-stream-playback.js` | DB `stream_key` + R2 HEAD |
| Upload hook | `stream-upload-pipeline.js` | Post-master transcode when AUTO=1 |
| Backfill CLI | `scripts/backfill-stream-assets.mjs` | Manual transcode + register |
| Debug headers | `/api/library/stream` | `X-Playback-Resolver` in dev/debug |

**Not activated on client:** `AudioContext`, `music-access.js`, `resolvePlaybackSrc` — same `/api/library/stream` contract.

---

## Production env status

Grep of workspace `.env*` files: **no hybrid flags set** (confirmed 2026-05-31).

**Production global rollout: NO** until staging canary completes.

---

## Activation readiness score

| Gate | Status |
|------|--------|
| Code deployed | ✅ In workspace |
| Migration applied | ✅ Columns exist |
| Stream assets in R2 | ❌ 404 on probe |
| DB stream registration | ❌ 0/5 sample rows |
| Automated tests | ✅ 21/21 |
| Staging canary | ⏳ After backfill |

**Overall: CONDITIONAL — activate flags on staging only after Phase B backfill.**
