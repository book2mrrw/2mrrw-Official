# 5. Signed URL caching

## Client: `streamMetaRef` (AudioContext.js)

```javascript
// shape after resolveLibraryStreamForTrack / fetchLibraryStream
{
  slug, url, fetchedAt, expiresIn, streamEventId, sessionId
}
```

| Behavior | Detail |
|----------|--------|
| Set on | `resolveLibraryStreamForTrack`, error retry, resume refresh, visibility hidden refresh |
| **Not set on** | Initial entitled play via `redirect=1` only (browser never sees JSON URL) |
| Refresh rule | `streamUrlNeedsRefresh`: expires within **5 min** of TTL (`STREAM_REFRESH_BEFORE_EXPIRY_MS`) |
| Visibility hidden | Background `fetchLibraryStream` updates meta (2131–2145) |
| Resume while playing | If meta stale, refresh + `waitAudioSrcReady` + seek (1920–1951) |

## Client: `backgroundStreamResolve`

- Enabled when `usesLibraryStream && entitledFullStream && !redirectFastPath && !preview-only`.
- **Current `resolvePlaybackSrc` always uses `redirect=1`**, so background resolve is **inactive** on normal entitled starts.
- Still relevant for `upgradeToFullStream` and legacy src strings.

## Client: `fetchLibraryStream` (stream-client.js)

- `GET /api/library/stream?slug=&force=&sessionId=`
- No client-side response cache beyond `streamMetaRef`
- 401/403 → `ACCESS_DENIED`; 409 → `CONCURRENT_STREAM`

## Server: `getOrCreateStreamSignedUrl` (stream-url-cache.js)

| Param | Value |
|-------|-------|
| Key | `{userId}:{slug}` |
| TTL | **8 minutes** in-process Map |
| Inflight dedupe | Per-key Promise coalescing |
| Factory | `createR2SignedGetUrl(key, 3600)` |

## Server: stream session (stream-pipeline.js)

| Param | Value |
|-------|-------|
| `STREAM_SIGNED_URL_TTL_SECONDS` | 3600 |
| Session overlap clear | 30s window — may delete/recreate sessions on rapid replays |

## Redirect mode (route.js)

- `redirect=1` → 302 to signed URL, `Cache-Control: no-store`, forwards `Range`
- Browser caches **not** the API response; R2 URL is presigned querystring

## Gaps

1. **streamMetaRef null** during redirect-only play → resume refresh / stale URL logic may not run until visibility handler or error.
2. **Server cache is per-instance** (Vercel) — cold instance = new sign on every JSON fetch.
3. **8 min client meta vs 60 min URL** — refresh window conservative (good) but extra JSON fetches on long sessions.

## Plan targets (see section 11)

- Populate `streamMetaRef` from a lightweight HEAD or optional `?meta=1` without second full audio load.
- Align redirect play with meta seeding for background refresh.
- Consider CDN cache headers on **public** previews only.
