# Error Analysis — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Section result:** **PASS** (no new error classes; expected fallback-dominated canary)

---

## Error taxonomy

### Server resolver errors (stream branch)

| Error / reason | HTTP impact | User impact | Rate (canary today) |
|----------------|-------------|-------------|---------------------|
| `flags_off` | 200 master | None | 0% when PREFERRED=1 |
| `no_stream_registration` | 200 master | None — silent fallback | **~100%** (0 DB registrations) |
| `r2_missing` | 200 master | None — silent fallback | High until backfill |
| `invalid_stream_key` | 200 master | None | ~0% |
| `invalid_stream_path` | 200 master | None | ~0% |
| `resolver_error` | 200 master | None (logged server-side) | Should be ~0% |

**Key:** Stream branch failures do **not** surface as 422/500 to client — master fallback preserves playback.

### Hard failures (pre-existing, unchanged)

| Condition | HTTP | Code |
|-----------|------|------|
| No auth | 401 | `Unauthorized` |
| Not entitled | 403 | `Not entitled to stream this item` |
| No playback key at all | 422 | `MEDIA_UNAVAILABLE` |
| Product not found | 404 | `Product not found` |

Hybrid flags do not introduce new HTTP error codes.

---

## Before vs after error profile

| Metric | Before (master-only) | After hybrid (flags ON, no assets) | After hybrid (stream hit) |
|--------|---------------------|-----------------------------------|---------------------------|
| Playback failures on entitled tap | Low (master exists) | **Same** (master fallback) | Low |
| Resolver exceptions | Rare | Same + caught in try/catch | Same |
| 422 MEDIA_UNAVAILABLE | When no master/preview | Unchanged | Unchanged |
| Stream miss user-visible error | N/A | **None** (fallback) | N/A |
| Client stream fetch errors | 401/403 → preview fallback | Unchanged | Unchanged |

**Net new user-facing errors: 0**

---

## Fallback rate analysis

**Expected during initial canary (no backfill):**

```
streamHitRate ≈ 0%
fallbackRate ≈ 100%
fallbacksByReason:
  no_stream_registration → majority
  r2_missing → if convention key probed without DB row
```

**Post-backfill target:**

```
streamHitRate > 95%
fallbackRate < 5%
```

Monitor via `X-Playback-Resolver` aggregate header in staging dev mode.

---

## R2 / CDN probe errors (2026-05-31)

| Probe | HTTP | Implication |
|-------|------|-------------|
| `streaming/.../hour-glass.m4a` | **404** | No public stream object — expected pre-backfill |
| `streaming/.../hour-glass_192.m4a` | **404** | HQ variant also absent |

These are **not user-facing errors** — resolver HEAD check triggers `r2_missing` → master fallback.

---

## Client error paths (unchanged)

**File:** `AudioContext.js`

| Trigger | Handler | Hybrid impact |
|---------|---------|---------------|
| Stream 401/403/404 | `getTrackPreviewSrc` fallback | None |
| Signed URL unreachable | `stream-client.js` throws → caught | None |
| Element `error` event | Availability cache + feedback | None |
| 15s command watchdog | Unchanged | None |

---

## Upload / backfill errors (AUTO_GENERATE)

| Failure | Master impact | Stream impact |
|---------|---------------|---------------|
| ffmpeg missing | **None** — master upsert succeeds | Stream skipped in `streamResults` |
| R2 upload fail | **None** | Logged; no DB registration |
| DB persist fail | **None** | Registration fails; playback uses master |

Non-blocking by design — catalog never blocked by stream generation failure.

---

## Monitoring recommendations (staging canary)

| Signal | Alert threshold |
|--------|-----------------|
| `fallbackRate` | >10% after full backfill |
| `fallbacksByReason.resolver_error` | >0 sustained |
| `/api/library/stream` 422 rate | Increase vs baseline |
| Client `playback/events` error types | New error class |
| Stream session creation failures | Increase vs baseline |

---

## Section result

**PASS** — Hybrid adds silent master fallback on stream miss; no new user-facing error classes. Initial canary will show high fallback rate (expected) until backfill completes.
