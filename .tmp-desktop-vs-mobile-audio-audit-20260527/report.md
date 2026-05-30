# Desktop vs Mobile Audio Audit — 2026-05-27

**Repo:** `/Users/recharge/artist-platform`  
**Mode:** Read-only (no code changes)  
**Production host probed:** `https://www.2mrrw.com`

## Executive summary

Desktop and mobile share one engine (`AudioContext` + hidden `<audio>` + optional Web Audio graph). There is **no separate mobile player binary**. Mobile failures come from **stricter browser policy** and **timing/races** that desktop often masks.

**Symptom clusters on mobile (priority):**

1. **No sound while UI shows playing** — Web Audio `MediaElementSource` + cross-origin R2 signed URLs; graph can output silence even when `currentTime` advances.
2. **Preview-only or stream errors for entitled users** — server session cookies not visible on `/api/library/stream` (401) or client `accountState` stale (admin/subscriber treated as guest preview).
3. **Play never starts after opening modal** — `playTrack` deferred from tap handler to `useEffect` when `authLoading` is true (gesture chain broken on iOS Safari).

Desktop “works” because Chrome is more permissive on autoplay/resume, auth bootstrap is faster, and entitled playback often uses `redirect=1` same-origin hop without hitting the broken `playAudioIfNotPaused` path.

## Top 3 root causes (ranked)

| Rank | Root cause | Mobile impact | Key evidence |
|------|------------|---------------|--------------|
| **1** | **Web Audio graph + cross-origin full stream (R2)** | HIGH — silent playback with playing UI | `initWebAudio` + `createMediaElementSource` (`AudioContext.js:515-541`, `2363-2369`); entitled `src` is R2 via redirect (`music-access.js:204-221`) |
| **2** | **Session / entitlement mismatch on stream API** | HIGH — 401/403, preview fallback, admin shows pricing | `stream/route.js:109-112`; auth key alignment in `auth-storage-key.js` + guest race (`AuthContext.js:109-143`, `session-user.js:5-31`); deferred modal play (`page.js:1121-1126`, `970-990`) |
| **3** | **Autoplay / gesture policy gaps** | HIGH on iOS, MEDIUM Android | Sync unlock only in `playTrack` (`1137-1146`); `resume`/`toggle`/visibility lack same unlock (`1862-1872`, `2072-2126`); inverted `playAudioIfNotPaused` (`123-131`, `1308`) |

## Production probes (curl, no browser auth)

| Request | Status | Body / notes |
|---------|--------|----------------|
| `OPTIONS /api/library/stream` | **204** | Preflight OK |
| `GET /api/library/stream?slug=hour-glass` | **401** | `{"error":"Unauthorized"}` |
| `GET /api/library/stream?slug=hour-glass&redirect=1` | **401** | Same (auth before redirect) |
| `GET /api/account/state` | **200** | Guest-shaped payload: `permissions.guest: true`, `user: null` |

**Interpretation:** Unauthenticated probes confirm stream gate is **identity**, not slug/entitlement. Authenticated mobile must be verified in DevTools (see `qa-mobile-checklist.md`).

## What is already fixed in tree (reduces but may not eliminate mobile issues)

- Unified Supabase `storageKey`: `2mrrw-auth-token` (`auth-storage-key.js`, `client.js`, `server.js`, `middleware.js`)
- Guest cookie cleared on fan login; admin not downgraded on stale guest payload (`AuthContext.js`)
- `<audio crossOrigin="anonymous">` + `playsInline` (`AudioContext.js:2363-2369`) — **newer than some prior audit docs**
- Sync gesture unlock at start of `playTrack` (`1137-1146`)
- Entitled fast path: `redirect=1` on `src` skips background JSON swap (`1217-1218`)

## Deliverables in this folder

| File | Purpose |
|------|---------|
| `desktop-path-map.md` | Happy-path trace (desktop) |
| `mobile-path-map.md` | Mobile-specific branches and failure points |
| `divergence-matrix.md` | Side-by-side comparison table |
| `recommended-fixes.md` | Ordered, production-safe actions (no implementation) |
| `qa-mobile-checklist.md` | DevTools verification steps |
| `manifest.txt` | File list |

## Related prior audits (reference)

- `.tmp-stream-401-root-cause-report-20260527/` — stream 401 identity gate
- `.tmp-mobile-admin-auth-fix-20260527/` — cookie key mismatch (commit `922381d` area)
- `.tmp-audio-output-audit-20260527/` — silent Web Audio hypotheses
- `.tmp-mobile-broken-features-audit-20260527/` — scrub, gesture unlock confirmation
