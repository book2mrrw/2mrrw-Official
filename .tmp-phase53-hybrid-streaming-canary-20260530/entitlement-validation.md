# Entitlement Validation — Hybrid Streaming Canary (Phase 5.3)

**Run date:** 2026-05-31  
**Prior audit:** Phase 5.2.14 unified entitlement PASS  
**Section result:** **PASS** (code-path + test matrix)

---

## Asset resolution by user type

| User type | Client access | `resolvePlaybackSrc` | Server `/api/library/stream` | Hybrid flags ON |
|-----------|---------------|----------------------|------------------------------|-----------------|
| **Guest** | `previewOnly: true`, `canStream: false` | `catalogPreviewAudioUrl` (CDN or API) | 401/403 | **No change** — never hits stream route for primary play |
| **Subscriber** | `canStream: true` | `libraryStreamRedirectSrc` | `userCanStreamProduct` → stream or master | Stream if registered, else master |
| **Collector card** | `canStream: true` via `collectorCardOwner` | Library stream redirect | Same entitlement gate | Same |
| **Purchaser** | `canStream: true` via `owned` | Library stream redirect | `userOwnsProduct` | Same |
| **Admin** | `adminTrackAccess()` | Library stream redirect | `isAdminUser` bypass | Same |

---

## Resolver chain (unchanged by hybrid)

```
UI tap
  → resolveTrackAccess(track, accountState)
  → resolvePlaybackSrc(track, access, { userId, accountState })
  → playQueue / playTrack → AudioContext.playTrackInternal
  → single <audio> element
```

Hybrid affects **server-only** step inside `/api/library/stream`:

```
resolvePlaybackKey
  → master discovery
  → [if isStreamPlaybackPreferred] tryResolveStreamPlaybackKey
  → sign + proxy
```

Client contract unchanged — same redirect URL shape.

---

## Guest → Preview (isolation proof)

| Check | Status |
|-------|--------|
| Guest `canStream: false` | ✅ `music-access.js` |
| No `libraryStreamRedirectSrc` for guest | ✅ `resolvePlaybackSrc` branch |
| Server 403 on entitled stream without permission | ✅ `validateStreamEntitlement` |
| Preview path independent of hybrid flags | ✅ No hybrid reads in `media-urls.js` |
| Stream keys never emitted to guest client | ✅ Server-side only |

**Direct preview flags:** Orthogonal. For hybrid-only canary, keep direct preview OFF — guest path unchanged from baseline.

---

## Entitled → Stream (canary target)

| Check | Status |
|-------|--------|
| Default flags OFF → master key signed | ✅ `gate-master-kept-flags-off` |
| Flags ON + registration → stream key | ✅ `gate-stream-replaces-master` |
| Flags ON + miss → master fallback | ✅ `gate-master-kept-on-r2-miss` |
| Single API contract for client | ✅ `/api/library/stream?redirect=1` |
| Entitlement before resolver | ✅ `validateStreamEntitlement` first |

**Current state:** All entitled plays resolve to **master** until backfill populates `stream_key`.

---

## Entitled → Master (fallback + downloads)

| Path | When | Hybrid role |
|------|------|-------------|
| Stream miss fallback | No registration / R2 404 | Master signed — automatic |
| Offline download | `getOfflinePlaybackUrl` hit | Hybrid bypassed client-side |
| `STREAM_PLAYBACK_PREFERRED=0` | Rollback | Master only |
| Preview safety net | Entitled request, no master in folder | Server serves preview — pre-existing |

---

## Server resolver layering

**File:** `src/lib/playback/resolve-playback-key.js`

1. Discover master in entity folder (`playbackSource: master`)
2. If no master → preview folder (entitled safety net, not guest browsing)
3. If `isStreamPlaybackPreferred()` → attempt stream swap
4. Record outcome in `playback-resolver-diagnostics`

`isStreamPlaybackPreferred()` = `HYBRID_STREAMING_ENABLED=1` **AND** `STREAM_PLAYBACK_PREFERRED=1`.

---

## Entitlement gates (authoritative)

| Layer | Function | Hybrid reads? |
|-------|----------|---------------|
| Client URL choice | `resolveTrackAccess` + `resolvePlaybackSrc` | ❌ |
| Client stream gate | `canRequestLibraryStream` | ❌ |
| Server stream gate | `userCanStreamProduct` | ❌ |
| Server resolver | `resolvePlaybackKey` | ✅ flags only |

**No client-side entitlement override introduced.**

---

## Album / multi-track entitlement

Album plays pass `trackSlug` to stream API:

```
/api/library/stream?slug={album}&trackSlug={track}&redirect=1
```

Per-track stream registration in `catalog_tracks.stream_key` supported. Backfill includes 30 track candidates.

---

## Validation commands

| Command | Result |
|---------|--------|
| `npm run test:playback-resolver-fallback` | 21/21 PASS |
| Phase 5.2.14 entitlement matrix | PASS (referenced) |
| Supabase entitlement columns | Unchanged |

---

## Section result

**PASS** — Guest→Preview, Entitled→Stream/Master, Collector offline→Master maps cleanly. Hybrid flags are server-internal; entitlement model unchanged from Phase 5.2.14.
