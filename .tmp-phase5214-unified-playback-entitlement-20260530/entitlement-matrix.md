# Entitlement Matrix — Playback Paths by User Type

**Phase 5.2.14** | Read-only audit

---

## Resolver chain (shared)

```
UI tap (card / tracklist / library)
  → normalizeCatalogItemForPlayback / albumTracksForPlayback
  → resolveTrackAccess(track, accountState)          [music-access.js]
  → resolvePlaybackSrc(track, access, { userId, accountState })
  → toPlaybackTrack → track.src + track.metadata.access
  → playQueue / playTrack → AudioContext.playTrackInternal
  → single <audio> element
```

**Account state source:** `AuthContext` → `/api/account/state` → `useEntitlementAccountState()` consumed by playback surfaces and `AudioContext`.

---

## Matrix

| User type | Client `resolveTrackAccess` | `resolvePlaybackSrc` asset | Server `/api/library/stream` | AudioContext path |
|-----------|----------------------------|----------------------------|------------------------------|-------------------|
| **Guest** | `previewOnly: true`, `canStream: false` | `catalogPreviewAudioUrl(preview_path)` — CDN direct (flag ON) or `/api/media/preview` discovery | 401/403 — no entitled session | `playTrackInternal` → preview `src`; 30s hard cap via `metadata.access.previewOnly` |
| **Subscriber** | `canStream: true` when `subscriptionActive` + `subscriberActive` + `permissions.subscriber` | `/api/library/stream?slug=…&redirect=1` (+ optional `trackSlug`) | `userCanStreamProduct` — membership + digital product | Same engine; background signed URL swap; full duration |
| **Collector card owner** | `canStream: true` via `collectorCardOwner` | Same library stream redirect | Same — `getCollectorAccessState.hasCollectorAccess` | Same as subscriber |
| **Purchased track owner** | `canStream: true` via `owned` (slug in owned/purchased sets) | Library stream redirect | `userOwnsProduct` short-circuit | Same engine; owned slugs persist after subscription lapse |
| **Purchased release owner** | `canStream: true` when `ownedSlugs.has(albumSlug)` or library purchase row | Library stream with release slug + `trackSlug` for album tracks | `userOwnsProduct` / library ownership | Album queue via `mapAlbumTracksForPlayback` — same `playQueue` |
| **Admin** | `adminTrackAccess()` — `canStream: true`, `previewOnly: false` | Library stream redirect | `isAdminUser` bypass in `validateStreamEntitlement` | Same engine; no purchase UI gates |

---

## Entry points → resolver (by surface)

| Surface | Play trigger | Queue builder | Entitlement injection |
|---------|--------------|---------------|----------------------|
| `LatestSinglesStyleRow` | `ReleaseCardPlayButton` → `playQueue([track], 0)` | Single-track | `toPlaybackTrack(playItem, accountState, source)` |
| `CatalogGrid` | Same via `ReleaseCardActions` | Single or `albumCardPlaybackItem` first track | `resolveContentAccess` for badge/cart only; play uses `toPlaybackTrack` |
| `AlbumTracklistSheet` | `playAndClose` → `playQueue(playable, queueIndex)` | `albumTracksForPlayback` → `playableReleaseQueue` | Per-track `resolveTrackAccess` inside `normalizeTrackForPlayback` |
| `ReleaseCardPlayButton` | `playQueue([track], 0)`; optional `upgradeToFullStream` after 2s if entitled+previewOnly mismatch | Single | Prewarm cache may supply pre-built `firstTrackPlayback` |
| `page.js` album modal | `playQueue(playable, queueIndex)` or entitled `playTrack` fallback | `albumTracksForPlayback` | `entitlementAccountState` from AuthContext |
| `MyMusicTab` | `playTrack` / `playQueue` — **UI gate** `if (!canStream) return` | Library items via `toPlaybackTrack` | Same engine when gate passes |

---

## Asset URL shapes

| Asset class | Typical URL | Resolver |
|-------------|-------------|----------|
| Preview (guest) | `https://{R2_CDN}/previews/...` or `/api/media/preview?folder=…` | `catalogPreviewAudioUrl` in `media-urls.js` |
| Full stream (entitled) | `/api/library/stream?slug={release}&redirect=1[&trackSlug=…]` → proxied signed R2 GET | `libraryStreamRedirectSrc` → server `resolvePlaybackKey` |
| Offline master (entitled + cached) | `blob:` or cache URL from `getOfflinePlaybackUrl` | `resolvePlaybackSrc` first branch when offline hit |
| CS alternate | CS presentation src from `resolvePlaybackPresentation` | Same `playTrackInternal`; not entitlement-tier specific |

---

## Client vs server entitlement

| Layer | Function | Role |
|-------|----------|------|
| Client access | `resolveTrackAccess` | Chooses preview vs stream URL in `resolvePlaybackSrc` |
| Client stream request gate | `canRequestLibraryStream` | Requires `canStream` + `userId === accountState.user.id` |
| Server stream gate | `userCanStreamProduct` | Authoritative 403 on `/api/library/stream` |
| Admin | `isAdminAccount` / `isAdminUser` | Full catalog both sides |

---

## Out-of-scope user shape (informational)

**Per-track collector ledger** (badge `Collector Access` without collector card): client sets `collector: true` but `canStreamFull = owned || isSubscriber || collectorCardOwner` — **does not** include per-track collector alone. Server `userCanStreamProduct` may still authorize via `hasCollectorAccess`. Not one of the six scoped user types; see `architecture-forks.md` fork #1.
