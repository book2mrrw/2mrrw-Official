# Rollback Verification — Phase 5.2.13

**Result: PASS** (flag-based rollback verified by unit tests)

---

## Rollback procedure

1. Set `NEXT_PUBLIC_DIRECT_PREVIEW_CDN=0` (or unset) on Vercel / local env
2. Set `DIRECT_PREVIEW_ENABLED=0` (or unset)
3. Redeploy

No code revert required.

---

## Verified behavior

| Flag state | `catalogPreviewAudioUrl("previews/singles/w2d/")` | API route |
|------------|---------------------------------------------------|-----------|
| OFF (default) | `/api/media/preview?folder=…` | Used |
| ON | `https://…r2.dev/previews/singles/w2d/w2d-preview.mp3` | Fallback only |

Test: `catalogPreviewAudioUrl flag off uses API discovery` in `scripts/test-direct-preview-cdn.mjs`.

---

## Systems unaffected by rollback

| System | Notes |
|--------|-------|
| `/api/library/stream` | Entitled playback — never gated by direct preview flag |
| Entitlements / collector | No code changes |
| Queue / Media Session | URL string source only |
| Analytics | No pipeline changes |
| `api/media/preview` route | Remains deployed; 302 fast path still works when flag off |

---

## Stale prewarm cache (low risk)

`PlaybackPrewarmCache` may retain CDN URLs until TTL/eviction after rollback. Bytes are identical; worst case one play uses direct CDN URL (still valid) until cache miss.

---

## Code revert alternative

Git revert of commits touching `media-urls.js` + feature flag module restores API-only path. API route unchanged — safe fallback for all clients.
