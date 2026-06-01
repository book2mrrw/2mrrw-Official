# Entitlement Validation — Phase 5.3.5 (Production)

**Production URL:** https://www.2mrrw.com  
**Flags (production):** `HYBRID_STREAMING_ENABLED=1`, `STREAM_PLAYBACK_PREFERRED=1`  
**Run date:** 2026-05-31

---

## Code-path matrix (unchanged from Phase 5.3.4)

| User type | Client | Server route | Hybrid ON |
|-----------|--------|--------------|-----------|
| **Guest** | `previewOnly: true`, `canStream: false` | `/api/media/preview` | No stream resolver |
| **Subscriber** | `canStream: true` | `/api/library/stream` | Stream → master fallback |
| **Collector** | `canStream: true` (card) | Same | Same |
| **Purchaser** | `canStream: true` (`ownedSlugs`) | Same | Same |
| **Admin** | `adminTrackAccess()` | Same + bypass | Same |

Server gate: `validateStreamEntitlement` → `userCanStreamProduct` before `resolvePlaybackKey`.

---

## Production API behavior

### Guest → Preview

| Check | Prod evidence | Status |
|-------|---------------|--------|
| `/api/account/state` → `user: null` | Live JSON | PASS |
| Stream without session → 401 | `library/stream` probes | PASS |
| Preview legacy path → 302 R2 CDN | hour-glass, 2-heavy, ad track 3 | PASS |
| Hybrid flags not required for preview | Preview route has no hybrid flag reads | PASS |

### Entitled → Stream

| Check | Evidence | Status |
|-------|----------|--------|
| Resolver stream-first when registered | 17/17 sample tracks → `playbackSource: stream` | PASS |
| Catalog 35/36 stream hits | phase533 script | PASS |
| Prod HTTP with entitled cookie | **Not executed** — no `E2E_SESSION_COOKIE` in run | DEFERRED |

### Entitled → Master fallback

| Path | When | Status |
|------|------|--------|
| `01-roll-call` | `MASTER_ABSENT` | Expected fallback — non-blocking |
| R2 miss / no registration | Automatic master path | Verified in 21/21 fallback tests |

---

## Production vs local flag parity

Production env vars confirmed set **before** redeploy `dpl_6qi3Y5iG8csx4vrjws2wdRdh7r83`.

Live resolver diagnostics header (`X-Playback-Resolver`) not enabled in production (`R2_STREAM_DEBUG` off). Entitlement routing validated via API status codes + offline resolver scripts against shared Supabase/R2.

---

## Verdict

| Segment | Result |
|---------|--------|
| Guest preview isolation | **PASS** |
| Entitled stream (resolver) | **PASS** |
| Entitled stream (live authenticated HTTP) | **DEFERRED** |
| Fallback safety | **PASS** |

**Entitlement validation:** **CONDITIONAL PASS**
