# Read-only audit: `/api/library/stream`

**Date:** 2026-05-28  
**Scope:** `src/app/api/library/stream/route.js` (snapshot in `stream-route.js.txt`)  
**Mode:** Read-only — no code changes in this bundle.

## Summary

The library stream route is the server gate for entitled full playback. It resolves identity, checks entitlements, resolves an R2 object key, creates stream session/event records, signs (or reuses cached) R2 URLs, and either returns JSON with a same-origin proxy URL or streams bytes via `redirect=1`. All JSON and proxied responses pass through `applyMediaCors`. Route is `force-dynamic`.

## HTTP methods

| Method | Behavior |
|--------|----------|
| **OPTIONS** | `mediaCorsPreflightResponse(req)` — 204 with media CORS headers (Range-aware preflight). |
| **GET** | Primary playback init: query params → auth → `buildStreamResponse`. |
| **HEAD** | Delegates to `GET` — same entitlement and proxy path as GET (used by client HEAD probes on `redirect=1` URLs). |
| **DELETE** | Clears stream session by `sessionId` or all sessions for user+product slug; requires auth; no entitlement re-check on delete. |

No POST/PUT/PATCH handlers.

## Authentication

- **GET/HEAD:** `getFanSessionUser() ?? getGuestUser()`. Missing user → **401** `{ error: "Unauthorized" }` with CORS applied.
- **DELETE:** Same identity resolution; **401** if no user.
- Guest passwordless users can hit the route when `getGuestUser()` succeeds (same as other library APIs).

## Entitlement

- **`validateStreamEntitlement`** runs before product/key resolution on GET/HEAD path inside `buildStreamResponse`.
- **Admin bypass:** `isAdminUser(user)` → skip `userCanStreamProduct` (fast path for admin streaming).
- **Everyone else:** `userCanStreamProduct(user.id, slug, user)` — **403** `{ error: "Not entitled to stream this item" }` when false.
- **DELETE** does not call entitlement validation (session cleanup only).

Related fixes documented elsewhere (`.tmp-stream-403-fix-20260528`): admin email/profile reconciliation so HEAD+redirect probes stop failing at 403 for admin sessions.

## Proxy vs JSON response

1. **Default GET (no `redirect=1`):** After signing, returns JSON:
   - `url`: same-origin path from `libraryStreamRedirectSrc(slug, { trackSlug })` → `/api/library/stream?slug=…&redirect=1` (+ optional `trackSlug`)
   - `expiresIn`, `sessionId`, `streamEventId`
2. **`redirect=1` on the request being handled:** After signing, **`proxySignedR2Get(req, url)`** — Next.js fetches presigned R2 with GET or HEAD and forwards body/headers (Range-safe). Browser never talks to `*.r2.cloudflarestorage.com` directly.

Client pattern: first call may get JSON proxy URL; `<audio>` / stream client loads the `redirect=1` URL for actual bytes.

## CORS

- All error and success responses wrapped with **`applyMediaCors(req, …)`** except OPTIONS (standalone preflight).
- Shared policy in `@/lib/server/media-cors`: allowlisted origins (production domains, Vercel previews, localhost), methods **GET, HEAD, OPTIONS**, headers include **Range**, expose **Accept-Ranges**, **Content-Range**, etc.
- Proxied R2 responses also get CORS via `proxySignedR2Get` → `applyMediaCors`.

## Query parameters

| Param | Methods | Meaning |
|-------|---------|---------|
| **`slug`** | GET, HEAD, DELETE | Required for GET/HEAD/DELETE. Product slug. Missing → **400**. |
| **`trackSlug`** | GET, HEAD | Optional; passed to `resolvePlaybackKey` for album/multi-track resolution. |
| **`redirect`** | GET, HEAD | `redirect=1` → byte proxy path instead of JSON metadata response. |
| **`force`** | GET, HEAD | `force=true` → clear stream sessions for user+product; dev-only cache clear via `clearMediaResolverCaches`. |
| **`sessionId`** | DELETE | Optional; if set, `clearStreamSession`; else clear all sessions for user+product. |

## Pipeline (GET/HEAD success path)

1. Entitlement check  
2. `resolveProductIdBySlug` — missing product → **404**  
3. Session hygiene (`findActiveStreamSession` / `clearStreamSessionsForUserProduct`)  
4. `resolvePlaybackKey(admin, slug, { trackSlug })` — failure → **422** `MEDIA_UNAVAILABLE`; no key → **404** `MEDIA_UNAVAILABLE`  
5. `createStreamSession`, `insertStreamEvent`  
6. `getOrCreateStreamSignedUrl` → `createR2SignedGetUrl`  
7. Redirect proxy or JSON with proxy src  

Uncaught errors → **500** `{ error: "Stream unavailable", code: "MEDIA_UNAVAILABLE" }`.

## Observability

- `R2_STREAM_DEBUG=1` logs R2 env presence (not secrets) at key points.
- Structured `console.error` / `console.warn` on resolve failures and DELETE errors.

## Dependencies (out of route file)

- `@/lib/commerce/entitlements` — `userCanStreamProduct`
- `@/lib/auth/session-user`, `@/lib/guest-session` — identity
- `@/lib/playback/resolve-playback-key`, `stream-pipeline`, `stream-url-cache`
- `@/lib/storage/r2` — signing
- `@/lib/server/r2-stream-proxy` — `proxySignedR2Get`
- `@/lib/music-access` — `libraryStreamRedirectSrc`
- `@/lib/auth/constants` — `isAdminUser`

## Risks / notes (read-only)

- HEAD-as-GET runs full `buildStreamResponse` including session creation and signing even for probes — intentional for parity but heavier than a minimal HEAD handler.
- Entitlement on stream route is authoritative; client must not bypass with raw R2 URLs except via signed proxy chain.
- DELETE without entitlement check assumes session IDs are unguessable and tied to authenticated user context in pipeline (verify in `stream-pipeline` if hardening).

