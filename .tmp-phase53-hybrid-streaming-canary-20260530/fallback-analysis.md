# Fallback Analysis — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Test command:** `npm run test:playback-resolver-fallback`  
**Result:** **21/21 PASS** (flags OFF and flags ON)

---

## Fallback design

Hybrid streaming never blocks playback. Stream attempt failures return `{ ok: false, fallbackReason }` and `resolvePlaybackKey` retains the discovered **master key**.

**Source chain:**

```
resolvePlaybackKey
  → discover master in entity folder (playbackSource: master)
  → if no master: preview folder (entitled safety net only)
  → if isStreamPlaybackPreferred():
       tryResolveStreamPlaybackKey
         → flags_off | no_stream_registration | invalid_* | r2_missing | resolver_error
       → on miss: keep master, set streamFallbackReason
```

---

## Fallback reason matrix

| Reason | Trigger | Master retained? | Expected rate (canary) |
|--------|---------|------------------|------------------------|
| `flags_off` | HYBRID=0 or PREFERRED=0 | ✅ | **100%** (default prod) |
| `no_stream_registration` | No `stream_key` in DB/metadata | ✅ | **~100% today** (0 registered) |
| `invalid_stream_key` | Key fails validation regex | ✅ | Low |
| `invalid_stream_path` | Path under wrong prefix | ✅ | Low |
| `r2_missing` | R2 HEAD returns null | ✅ | High until backfill |
| `resolver_error` | Unexpected exception | ✅ | Should be ~0% |

---

## Automated test coverage

| Scenario ID | Category | Validates |
|-------------|----------|-----------|
| `flags-hybrid-off-preferred-on` | flags | PREFERRED ignored when HYBRID=0 |
| `flags-hybrid-on-preferred-off` | flags | Master only when PREFERRED=0 |
| `fallback-no-registration` | fallback | `no_stream_registration` |
| `fallback-r2-missing` | fallback | `r2_missing` → master |
| `fallback-hybrid-on-preferred-off` | fallback | Stream registered but flags_off |
| `fallback-invalid-stream-key` | fallback | Invalid key → master |
| `fallback-invalid-stream-path` | fallback | Invalid path → master |
| `gate-master-kept-on-r2-miss` | gate | Full resolve gate simulation |
| `gate-master-kept-flags-off` | gate | Master unchanged |
| `gate-stream-replaces-master` | stream | Stream hit replaces master |
| `shadow-metrics-aggregate` | metrics | Fallback rate tracking |

---

## Expected fallback rate during canary

| Phase | HYBRID | PREFERRED | Assets | Stream hit rate | Fallback rate |
|-------|--------|-----------|--------|-----------------|---------------|
| Pre-backfill | 1 | 1 | None | **~0%** | **~100%** (`no_stream_registration` / `r2_missing`) |
| Partial backfill | 1 | 1 | Some | **~N/36** | Remainder master |
| Full backfill | 1 | 1 | All 36 | **Target >95%** | **<5%** (transient R2 misses) |
| Rollback | 1 | 0 | Any | **0%** | **100%** (`flags_off`) |

**Current DB state (2026-05-31):** 0/5 sampled products have `stream_key` → enabling PREFERRED=1 yields **100% master fallback** (safe, no user-facing error).

---

## Client-side fallback (orthogonal)

| Trigger | Path | Hybrid impact |
|---------|------|---------------|
| Stream 401/403/404 | `AudioContext` → `getTrackPreviewSrc` | Unchanged — preview fallback for entitled mismatch |
| Signed URL expiry | `fetchLibraryStream` refresh | Unchanged — same stream API |
| Offline cache hit | `getOfflinePlaybackUrl` before stream | **Bypasses hybrid** — master blob |

Hybrid resolver fallback is **server-only**. Client always requests same `/api/library/stream?redirect=1`.

---

## Diagnostics

When `NODE_ENV=development` or `R2_STREAM_DEBUG=1`:

- Response header `X-Playback-Resolver` includes `result`, `fallbackReason`, `flags`, aggregate metrics
- `playback-resolver-diagnostics.js` tracks stream hit rate, fallback rate, avg duration

**Monitor during staging canary:**

```
fallbackRate = fallbacks / total
streamHitRate = stream / total
fallbacksByReason.no_stream_registration  → backfill incomplete
fallbacksByReason.r2_missing                → R2 sync issue
```

---

## Section result

**PASS** — All fallback paths preserve master playback. Canary can enable flags before assets exist without playback failure risk. Latency benefit requires reducing fallback rate via backfill.
