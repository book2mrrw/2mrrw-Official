# Entitlement + audio playback fix — 2026-05-28

## Prompt requirements

1. Audit entitlement tiers (no rewrite).
2. Fix `401` on `/api/library/stream?slug=w2d`.
3. Fix audio not reaching the player (stream URL + preview paths).
4. Preserve: folder-authoritative media, entity-folder paths, `site-api-url` fixes (b72a707), incomplete media tolerance, auth readiness guards.
5. `npm run build` must pass.
6. Report in `.tmp-entitlement-audio-fix-20260528/` + zip to Downloads.
7. Commit, push, and `vercel --prod` when production-critical.

## Root cause

### 401 on `/api/library/stream?slug=w2d`

The stream route returns **401** only when `getFanSessionUser()` and `getGuestUser()` both return null (`src/app/api/library/stream/route.js:137-139`). Entitlement denial is **403**, not 401.

Observed `[stream-client] library stream 401` means the browser called the stream API **without a server-visible session**, while the client often still had:

- `canStream: true` from `/api/account/state` or optimistic client auth, and/or
- A playback `src` of `/api/library/stream?slug=w2d&redirect=1` from `resolvePlaybackSrc`.

**Slug:** Catalog and DB use `w2d` (not `w-2-d`). The EP track variant `02-w-2-d` is scoped to album `love-hz-vol-1` via `trackSlug`, not the single `w2d`.

### No audio anywhere

Two compounding failures:

1. **Library stream before session alignment** — Redirect fast-path loaded `/api/library/stream` on the `<audio>` element without cookies; 401 HTML/JSON broke playback. `streamMetaRef` was never set on redirect-only plays, so the global `error` handler skipped preview fallback (`streamMetaRef.current` guard).
2. **Legacy preview paths** — Storefront still ships `/audio/previews/w2d-preview.mp3`. `catalogPreviewAudioUrl` mapped that to flat CDN `previews/w2d-preview.mp3` instead of entity folder `previews/singles/w2d/` or `/api/media/preview` discovery.

## Step 1 — Entitlement audit (read-only)

| Tier | Server (`userCanStreamProduct`) | Client (`resolveTrackAccess`) | Notes |
|------|--------------------------------|-------------------------------|-------|
| Admin | `isAdminUser` → true | `permissions.admin` → full stream | OK |
| Collector card | `getCollectorAccessState` → all digital products | `collectorCardOwner` → full stream | OK |
| Subscriber | Active membership → all digital products | Requires `subscriberActive` + `permissions.subscriber` | OK when account state synced |
| Purchaser | `userOwnsProduct(slug)` | `owned` / library purchase slugs | OK per slug |
| Unentitled | false → 403 if session exists | `previewOnly` | Preview via `/api/media/preview` (no auth) |

No entitlement architecture rewrite. Tier logic was correct; playback used full stream URLs before the server session matched the client user.

## Fixes applied (minimal scope)

| File | Change |
|------|--------|
| `src/lib/music-access.js` | `canRequestLibraryStream()` — full stream only when `accountState.user.id === userId`. |
| `src/lib/music-playback.js` | Pass `accountState` into `resolvePlaybackSrc`. |
| `src/lib/media-urls.js` | Legacy `audio/previews/*` and flat `previews/*` → `/api/media/preview` folder discovery (PREVIEW_ROOT = `previews`). |
| `src/context/AudioContext.js` | Preview fallback when redirect stream fails; `onError` retry when src is library stream without `streamMetaRef`; `upgradeToFullStream` gated on server session alignment. |

**Not changed:** UI, Auth OTP, `AudioContext` orchestration structure, `userCanStreamProduct`, entity-folder resolvers, `site-api-url.js`.

## Verification

- `npm run build` — **passed** (Next.js 16.2.4).
- Unauthenticated: preview should hit `/api/media/preview?folder=previews/singles/w2d/` (no 401).
- Entitled with cookies: `/api/library/stream?slug=w2d&redirect=1` → 302 signed R2.
- Entitled without server session: plays preview until `account/state` returns matching `user.id`.

## Remaining risks

- OTP users on Safari still need cookie-backed `createBrowserClient` (b72a707-era auth fix). If cookies never sync, they hear previews until session aligns.
- Album track play must pass `trackSlug` query param (already supported on stream route).
