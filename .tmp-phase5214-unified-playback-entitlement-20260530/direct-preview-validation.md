# Direct Preview Flag Validation

**Phase 5.2.14** | Section result: **PASS**

---

## Flags

| Variable | Module | Default | Scope |
|----------|--------|---------|-------|
| `NEXT_PUBLIC_DIRECT_PREVIEW_CDN` | `direct-preview.js` | OFF | Client + SSR |
| `DIRECT_PREVIEW_ENABLED` | `direct-preview.js` | OFF | Server supplement |

Helper: `isDirectPreviewCdnEnabled()` — used by `catalogPreviewAudioUrl` in `media-urls.js`.

---

## What changes when flag ON

**Preview path only:**

```text
catalogPreviewAudioUrl(previewPath)
  → resolveConcretePreviewR2Key (when eligible)
  → getPublicR2Url(key)           // direct CDN
  else
  → previewDiscoveryUrl(...)      // /api/media/preview redirect (unchanged)
```

**Entitled path — unchanged:**

| Function | Flag interaction |
|----------|------------------|
| `resolvePlaybackSrc` | Uses `libraryStreamRedirectSrc` when `canRequestLibraryStream` — **never** calls `isDirectPreviewCdnEnabled` |
| `libraryStreamRedirectSrc` | Same-origin `/api/library/stream` |
| `/api/library/stream` route | `resolvePlaybackKey` → signed R2 — no direct-preview import |
| `resolve-playback-key.js` | Master/stream resolver — independent of direct preview |
| `playback-prewarm-cache.buildPlaybackUrlDescriptor` | Sets `streamPath` for entitled; `previewSrc` uses `catalogPreviewAudioUrl` ( picks up flag for guests only in practice) |

---

## User type impact

| User type | DIRECT_PREVIEW affects play? |
|-----------|------------------------------|
| Guest | ✅ Yes — preview URL may skip `/api/media/preview` hop |
| Subscriber | ❌ No — stream redirect |
| Collector card owner | ❌ No |
| Purchased owner | ❌ No |
| Admin | ❌ No |

---

## AudioContext / queue impact

- `playTrackInternal` loads whatever string is in `track.src`.
- Queue stores resolved URLs at build time via `toPlaybackTrack`.
- Flag changes URL string origin for previews only — **no** AudioContext code branches on `DIRECT_PREVIEW_*`.

---

## `/api/media/preview` route

Still serves discovery redirect for:

- Non-canonical releases
- Missing concrete R2 key when flag ON
- Artwork / video type params

Entitled users do not use this route for playback under normal access resolution.

---

## Prewarm

`usePlaybackCardPrewarm` → `buildPlaybackUrlDescriptor` → `catalogPreviewAudioUrl` for preview leg. Entitled `streamPath` unaffected. Cache may hold CDN preview URLs when flag ON — same bytes, different origin (Phase 5.2.13 note).

---

## Rollback safety

Flag OFF → `catalogPreviewAudioUrl` reverts to pre-5.2.13 discovery API behavior. Entitled stream path identical in both states.

---

## Section result

**PASS** — `DIRECT_PREVIEW_ENABLED` affects preview asset URL resolution only; entitled playback paths are isolated.
