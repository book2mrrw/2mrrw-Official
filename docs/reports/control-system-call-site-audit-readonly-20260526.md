## Control System API usage (read-only audit)

**Env / URL construction (storefront runtime)**  
- `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` and `NEXT_PUBLIC_CONTROL_SYSTEM_URL` are read only in `/Users/recharge/artist-platform/src/lib/control-system/client.js` (`getControlSystemApiUrl`, lines 18–31).  
- No hardcoded `2mrrw-control` / `control-system.vercel` strings under `src/`.  
- Same env names appear in **docs**, **recovery scripts** (`/Users/recharge/artist-platform/scripts/recovery/lib/env-check.mjs`), and **reports** — those are not storefront runtime calls.

**Direct `fetch()` / streaming to Control System** (URL is `${apiBaseUrl}/api/...` from env)

| # | File | Line(s) | Server vs client | try/catch | Timeout (`AbortSignal` / `AbortController`) | On failure |
|---|------|---------|------------------|-----------|-----------------------------------------------|-------------|
| 1 | `/Users/recharge/artist-platform/src/lib/control-system/client.js` | 51–78 (`fetchControlSystemJson`) | **Both** — imported from client hooks/components and from `releases` / `vault` / `audio-visuals` used in **Next.js route handlers** (server) and `"use client"` modules | **Yes** — outer `try/catch`, empty `catch` | **No** | Returns `{ ok: false, payload: null, status: 0 or HTTP }` (no throw). Missing env: returns early without `fetch` (lines 48–49). |
| 2 | `/Users/recharge/artist-platform/src/lib/control-system/playback.js` | 56–67 (`sendControlSystemPlaybackEvent`) | **Client** — used from `/Users/recharge/artist-platform/src/context/AudioContext.js` (`"use client"`) | **Yes** | **No** | Returns `false`; callers do not await / do not branch on result (fire-and-forget). |
| 3 | `/Users/recharge/artist-platform/src/lib/control-system/media.js` | 155–168 (`fetchSignedUrl`) | **Both** — called from `resolveMediaAssetUrl` / `resolvePublicArtworkUrl`, used by `releases.js` and `vault.js` on server (catalog routes) and client | **Yes** | **No** | Returns `""`; callers fall back to public URL / existing fields. |
| 4 | `/Users/recharge/artist-platform/src/lib/control-system/media.js` | 201–224 (`fetchSignedUrlsBatch` POST to `${apiBaseUrl}/api/media/signed-urls`) | **N/A in app** — function is exported but **not imported** anywhere else in `src/` | **Yes** (batch only) | **No** | Falls through to per-endpoint `fetchSignedUrl`; never reached from current app wiring. |
| 5 | `/Users/recharge/artist-platform/src/hooks/sync/useRealtimeEvents.js` | 138–152 (`replayMissedEvents`) | **Client** — `"use client"` | **Yes** | **No** | Silent: replay skipped; SSE remains primary. |
| 6 | `/Users/recharge/artist-platform/src/hooks/sync/useRealtimeEvents.js` | 167 (`new EventSource(target.href)`) | **Client** | Not `try/catch` on construct; **`source.onerror`** (182–188) | **No** (browser / SSE semantics) | Connection closed; status `error`; exponential reconnect; after **8** failures, **silent** pause with console warning (119–121). |

**`fetchControlSystemJson` call sites** (all delegate to row #1 — same try/catch/timeout/failure behavior)

| File | Line(s) | Path | Server vs client |
|------|---------|------|------------------|
| `/Users/recharge/artist-platform/src/lib/control-system/releases.js` | 384 | `GET /api/public/releases` | Both (via `getLatestControlSystemSingles` / albums / features / latest + **route handlers**) |
| `/Users/recharge/artist-platform/src/lib/control-system/releases.js` | 395 | `GET /api/releases/{slug}/media` | Both |
| `/Users/recharge/artist-platform/src/lib/control-system/releases.js` | 462 | `GET /api/releases/{slug}` | Both |
| `/Users/recharge/artist-platform/src/lib/control-system/vault.js` | 125 | `GET /api/vault/content` | Client (via `useVaultMedia` → `useSyncEngine`) |
| `/Users/recharge/artist-platform/src/lib/control-system/vault.js` | 146 | `GET /api/vault/content/{id}/media` | **No callers** in `src/` besides definition |
| `/Users/recharge/artist-platform/src/lib/control-system/audio-visuals.js` | 148 | `GET /api/audio-visuals` | Client |
| `/Users/recharge/artist-platform/src/hooks/media/useMediaAssets.js` | 45 | `GET /api/hero` | Client |
| `/Users/recharge/artist-platform/src/lib/control-system/account.js` | 47, 53 | `GET /api/account/state`, `GET /api/library` | **No imports** of these functions under `src/` (dead for current storefront) |
| `/Users/recharge/artist-platform/src/lib/control-system/circle.js` | 53 | `GET /api/circle/events` | **No imports** under `src/` (dead for current storefront) |

---

### Per unique file (bullets)

**`/Users/recharge/artist-platform/src/lib/control-system/client.js`**  
- Defines `getControlSystemApiUrl`, `buildControlSystemUrl`, `fetchControlSystemJson`; reads `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` / `NEXT_PUBLIC_CONTROL_SYSTEM_URL`.  
- **Server + client** library.  
- **try/catch:** yes on `fetch` + `json()`. **Timeout:** none.  
- **Failure:** non-throwing `{ ok: false }`; missing base URL skips network.

**`/Users/recharge/artist-platform/src/lib/control-system/releases.js`**  
- All catalog JSON goes through `fetchControlSystemJson` (lines 384, 395, 462).  
- **Server:** `/Users/recharge/artist-platform/src/app/api/catalog/hydrate/route.js` (31–33), `/Users/recharge/artist-platform/src/app/api/catalog/releases/route.js` (16).  
- **Client:** `/Users/recharge/artist-platform/src/hooks/releases/useReleases.js`; `/Users/recharge/artist-platform/src/app/page.js` (1079, 1108) `getControlSystemReleaseDetail`.  
- **Fallback:** `ok` false → empty lists / `fallbackRelease`; then `resolveControlSystemMediaUrls` may still **call CS again** via `media.js` `fetchSignedUrl` for assets.

**`/Users/recharge/artist-platform/src/lib/control-system/media.js`**  
- **Extra CS traffic:** GET to `${apiBaseUrl}/api/media/.../signed-url` when resolving assets (no timeout, try/catch returns empty string).  
- Optional batch POST exists but is **unused** by the app today.

**`/Users/recharge/artist-platform/src/lib/control-system/vault.js`**  
- Client-driven vault list via `fetchControlSystemJson` (125); `getControlSystemVaultMedia` (146) unused from `src/`.  
- **Fallback:** `ok` false → `fallbackSections`.

**`/Users/recharge/artist-platform/src/lib/control-system/audio-visuals.js`**  
- Client via `useAudioVisuals` → `fetchControlSystemJson` (148).  
- **Fallback:** `ok` false → `fallbackVisuals`.

**`/Users/recharge/artist-platform/src/lib/control-system/playback.js`**  
- Client-only POST `/api/playback/events` from `AudioContext`.  
- **Fallback:** `false`; UI does not depend on success.

**`/Users/recharge/artist-platform/src/hooks/media/useMediaAssets.js`**  
- Client: hero `fetchControlSystemJson("/api/hero")` (45); vault/audio-visuals via sibling libs.  
- Wrapped by `useSyncEngine`: if fetcher **threw**, would set `error` + `fallbackData` — but CS helpers mostly **return** instead of throw.

**`/Users/recharge/artist-platform/src/hooks/releases/useReleases.js`**  
- Client-only; no direct `fetch` — uses `releases.js` (CS-backed).

**`/Users/recharge/artist-platform/src/hooks/sync/useRealtimeEvents.js`**  
- Client: JSON replay `fetch` + `EventSource` to `/api/sync/replay` and `/api/sync/stream`.  
- **Failure:** degraded realtime + status errors; not a full page crash.

**`/Users/recharge/artist-platform/src/hooks/sync/useSyncEngine.js`**  
- Does not call CS directly; orchestrates refetch on SSE events. **Circuit breaker** (3 failures / 30s) reduces hammering on focus/visibility only.

**`/Users/recharge/artist-platform/src/app/page.js`**  
- Client: `getControlSystemReleaseDetail` for modals (1079, 1108); `.then` only — no extra catch (promise does not reject if helpers stay non-throwing).

**`/Users/recharge/artist-platform/src/context/AudioContext.js`**  
- Client: `sendControlSystemPlaybackEvent` (516, 1193, 1589) — no await, no local catch beyond `playback.js`.

**`/Users/recharge/artist-platform/src/app/api/catalog/hydrate/route.js`**  
- **Route handler (server):** awaits `getLatestControlSystemSingles` + `getControlSystemAlbums` — full CS dependency for hydration shape; returns JSON 200 with possibly empty/partial `tracks` if CS is down (no route-level try/catch beyond what libs return).

**`/Users/recharge/artist-platform/src/app/api/catalog/releases/route.js`**  
- **Route handler (server):** paginated singles from CS; empty list if CS unavailable.

**`/Users/recharge/artist-platform/src/lib/control-system/account.js`** / **`circle.js`**  
- Implement CS calls but **no storefront `src` imports** found — reserved / unused in current tree.

---

### Storefront fragility when Control System deploys

- **No request timeouts** anywhere on these paths — slow or stuck CS can leave **server route handlers** (`/api/catalog/*`) and **client** `useSyncEngine` initial loads waiting until the platform default fetch timeout.  
- **Catalog and media are coupled to CS twice:** JSON catalog (`fetchControlSystemJson`) then optional **signed URL** GETs (`media.js`) per asset — a partial CS outage can mean JSON succeeds but previews fail, or the reverse.  
- **Realtime** (`EventSource`) stops updating after repeated failures; UI keeps **stale** data until manual refocus/refetch (subject to circuit breaker).  
- **Server-side catalog routes** do not use embedded fallbacks the way client hooks do — if env is set but CS is down, responses skew toward **empty or minimal** data rather than hardcoded fallbacks (unless callers pass fallbacks).  
- **Playback analytics** to CS are best-effort; playback to **storefront** `/api/library/stream` is a separate path — CS downtime does not by itself stop audio, but **catalog, hero, vault, visuals, hydration, and live sync** all degrade through the paths above.

---

**Note:** `NEXT_PUBLIC_*` is inlined at build time for the browser bundle; **server** route handlers read `process.env` at runtime in Node — deploy ordering between storefront and Control System still affects **SSR and `/api/catalog/*`** immediately after a bad deploy.