# Control System Resilience Fix Report

**Date:** 2026-05-26  
**Repository:** artist-platform  
**Commit:** `097c6a68854cc0d0832ed2bcde89b2f6725ad464`  
**Commit message:** fix(resilience): 4s timeout on all Control System calls, server route fallbacks, inline catalog as last-resort fallback — storefront never goes down when Control System deploys

---

## Executive summary

During Control System (CS) deployments, upstream API calls could hang or fail while the CS service restarted. That left catalog API routes erroring or blocking and the storefront browse experience empty or stuck loading. This change adds a **4-second AbortController timeout** on all CS JSON and signed-URL fetches, **graceful JSON fallbacks** on catalog server routes, and an **inline static catalog** on the home page when `/api/catalog/releases` fails or returns a degraded payload. Together, these layers ensure the cinematic storefront continues to render known singles and albums from in-repo static data instead of going down when CS is unavailable.

Build verification: **`npm run build` passes** on artist-platform after this commit (Next.js App Router; no new build failures introduced by this diff).

---

## Problem: storefront down during CS deploy

**Symptoms**

- Home page catalog fetch to `/api/catalog/releases` could wait indefinitely on CS-backed `getLatestControlSystemSingles` when CS was restarting or slow.
- Uncaught failures in `/api/catalog/hydrate` could surface as 500s instead of partial playback shapes.
- Empty or failed API responses left browse singles unset; users saw a broken or empty catalog until CS recovered.

**Root cause**

- `fetchControlSystemJson` had no request timeout; hung TCP connections blocked server routes and client hydration paths.
- Catalog routes assumed CS always returned valid arrays; no structured fallback for deploy windows.
- `page.js` relied on static `singles` only as implicit default when fetch succeeded partially; non-OK responses and `fallback: true` were not handled explicitly.

**Goal**

- Fail fast (4s), degrade gracefully, and always show the embedded static catalog as last resort on page 1.

---

## Fix 1: 4s AbortController in `fetchControlSystemJson`

**File:** `src/lib/control-system/client.js`

**Behavior**

1. Creates an `AbortController` and schedules `controller.abort()` after **4000 ms**.
2. Merges any caller-provided `fetchOptions.signal` so external abort also aborts the combined request (listener cleanup on completion).
3. Passes `signal: controller.signal` to `fetch`.
4. On server (`typeof window === "undefined"`), adds `next: { revalidate: 30 }` for bounded caching without blocking deploy recovery indefinitely.
5. On `AbortError`, logs `[ControlSystem] Request timed out:` with the path; returns `{ ok: false, payload: null, status: 0 }` like other failures.
6. Clears timeout and removes abort listeners in `cleanup()` on success, HTTP error, or catch.

**Code summary (conceptual)**

```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 4000);
// merge external signal → controller.abort
const response = await fetch(target.href, {
  ...restFetchOptions,
  ...(isServer ? { next: { revalidate: 30 } } : {}),
  signal: controller.signal,
  // headers: Accept, optional x-control-session-id
});
// cleanup(); return ok/payload or ok:false on timeout/error
```

All CS catalog helpers that use `fetchControlSystemJson` inherit this timeout automatically.

---

## Fix 2: Catalog route fallbacks (exact response shapes)

### `/api/catalog/releases` — `src/app/api/catalog/releases/route.js`

**Happy path (unchanged shape):**

```json
{
  "tracks": [ /* mapped singles slice */ ],
  "total": 123,
  "page": 1,
  "hasMore": true,
  "limit": 24
}
```

**Fallback** (CS error, timeout, non-array, or empty catalog — `catch` or explicit throw when `all.length === 0`):

```json
{
  "tracks": [],
  "total": 0,
  "page": 1,
  "hasMore": false,
  "limit": 24,
  "fallback": true
}
```

Note: `page` and `limit` reflect the request query; pagination stops (`hasMore: false`) so the client can switch to inline catalog.

### `/api/catalog/hydrate` — `src/app/api/catalog/hydrate/route.js`

**Happy path:**

```json
{
  "tracks": [ /* toPlaybackShape entries */ ],
  "hydratedCount": 0,
  "failedIds": []
}
```

(Early exit when no ids still returns `{ tracks: [], hydratedCount: 0, failedIds: [] }`.)

**Fallback** (any error in CS fetch / mapping):

```json
{
  "tracks": [ /* one toPlaybackShape({ slug, title: "Restored" }) per id */ ],
  "hydratedCount": 0,
  "failedIds": [ /* all requested ids */ ],
  "fallback": true
}
```

Playback can still attempt minimal shapes; UI/library code can detect `fallback: true` and avoid treating hydration as fully authoritative.

---

## Fix 3: Inline catalog fallback in `page.js`

**File:** `src/app/page.js`

**Aliases**

- `INLINE_SINGLES`, `INLINE_FEATURES`, `INLINE_ALBUMS` — same arrays as existing static `singles`, `features`, `albums` (comment documents last-resort use when CS or releases API is unavailable).

**Catalog fetch effect changes**

1. Parse JSON in try/catch; treat parse failure as `{}`.
2. If `!res.ok` and `catalogPage === 1`: set browse singles from `INLINE_SINGLES` (via `withR2CatalogMedia`), `setCatalogHasMore(false)`, return.
3. If `data.fallback === true` **or** (`catalogPage === 1` && `tracks.length === 0`): same inline path.
4. Merge path uses `INLINE_SINGLES` for static slug map and page-1 seed list.
5. Outer `catch`: on page 1, set inline singles and `catalogHasMore(false)` (explicit instead of silent “keep static”).
6. `displaySingles` and `catalogPlaybackBySlug` use `INLINE_SINGLES` / `INLINE_FEATURES` for consistent last-resort playback map.

**Result:** First page of browse always has a populated catalog during CS deploy; pagination does not infinite-loop on empty fallback responses.

---

## Fix 4: `fetchSignedUrl` timeout

**File:** `src/lib/control-system/media.js`

**Behavior**

- Same **4000 ms** `AbortController` on GET to signed-URL endpoints.
- `signal: controller.signal` on fetch.
- `AbortError` → `console.warn("[ControlSystem] Request timed out:", endpoint)` and return `""`.
- `finally` block clears `timeoutId`.

Prevents signed cover/audio URL resolution from hanging the media pipeline during CS outages; callers already treat empty string as missing URL.

---

## Build status

| Item | Result |
|------|--------|
| Command | `npm run build` (artist-platform) |
| Exit code | **0 (success)** |
| Commit SHA | `097c6a68854cc0d0832ed2bcde89b2f6725ad464` |
| Files in commit | 5 changed, 143 insertions, 50 deletions |

---

## Confirmations checklist

- [x] All Control System JSON fetches through `fetchControlSystemJson` use a 4s abort timeout with cleanup and optional external signal forwarding.
- [x] Server-side CS fetch uses `next.revalidate: 30` without removing `cache: "no-store"` on the fetch itself.
- [x] `/api/catalog/releases` returns HTTP 200 with `fallback: true` and empty tracks on CS failure (no unhandled exception).
- [x] `/api/catalog/hydrate` returns HTTP 200 with restored minimal tracks and `fallback: true` on CS failure.
- [x] Home page uses inline static singles on non-OK releases response, `fallback: true`, or empty first-page tracks.
- [x] Home page catch block explicitly seeds inline singles on page 1.
- [x] `fetchSignedUrl` uses 4s timeout and returns empty string on timeout.
- [x] Production build completes successfully after changes.
- [x] No UI layout/cinematic redesign; behavior-only resilience (guardrails respected).

---

## Files changed

| File | Summary |
|------|---------|
| `src/lib/control-system/client.js` | 4s AbortController, signal merge, server revalidate, timeout logging |
| `src/lib/control-system/media.js` | 4s timeout on signed URL fetch |
| `src/app/api/catalog/hydrate/route.js` | try/catch with fallback JSON shape |
| `src/app/api/catalog/releases/route.js` | try/catch, empty-array guard, fallback JSON shape |
| `src/app/page.js` | INLINE_* aliases, inline catalog on API failure/fallback |

---

## Deliverable archive

- Report: `docs/reports/control-system-resilience-fix-report-20260526.md`
- Manifest: `docs/reports/control-system-resilience-fix-report-20260526-manifest.txt`
- Zip: `~/Downloads/control-system-resilience-fix-report-20260526.zip`
