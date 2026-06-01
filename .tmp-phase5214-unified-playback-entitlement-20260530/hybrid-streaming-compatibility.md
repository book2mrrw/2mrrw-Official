# Hybrid Streaming Compatibility

**Phase 5.2.14** | Section result: **PASS**

---

## Target architecture (product spec)

| User / asset | Playback asset | Resolver |
|--------------|----------------|----------|
| Guest | Preview | `catalogPreviewAudioUrl` / preview folder |
| Entitled (subscriber, collector card, purchaser, admin) | Stream (preferred) or master | `/api/library/stream` → `resolvePlaybackKey` |
| Collector download (offline) | Master (local) | `getOfflinePlaybackUrl` in `resolvePlaybackSrc` |

---

## Feature flags (all default OFF)

From `hybrid-streaming.js`:

| Flag | Effect when ON |
|------|----------------|
| `HYBRID_STREAMING_ENABLED` | Master switch for hybrid code paths |
| `STREAM_PLAYBACK_PREFERRED` | Prefer stream rendition over master in `resolvePlaybackKey` |
| `AUTO_GENERATE_STREAM_ASSETS` | Upload pipeline transcode (out of playback audit scope) |

`isStreamPlaybackPreferred()` = hybrid enabled **and** stream preferred.

---

## Server resolver layering

`resolve-playback-key.js` flow:

1. Discover master audio in entity folder (`playbackSource: master`).
2. If no master, fall back to preview folder (`playbackSource: preview`) — server-side safety net for entitled requests missing master.
3. If `isStreamPlaybackPreferred()`, attempt `tryResolveStreamPlaybackKey` → swap to stream key when available.

**Clean separation:** Preview fallback inside server resolver is for missing masters on **entitled** stream requests, not guest catalog browsing. Guests never hit this route.

---

## Client layering

```text
resolvePlaybackSrc
  1. offline master (entitled + cache hit)
  2. library stream redirect (entitled + session aligned)
  3. catalogPreviewAudioUrl (guest / preview-only)
```

No hybrid flag reads on client — client always requests same-origin stream proxy; server chooses master vs stream key.

---

## Guest → Preview

- Client: `canStream: false` → never `libraryStreamRedirectSrc`.
- Server: `/api/library/stream` returns 403 for guests without entitlement (guest user session still exists but `userCanStreamProduct` fails).

**No leakage** of stream keys to guest client resolver.

---

## Entitled → Stream

- Default (flags OFF): `resolvePlaybackKey` signs **master** key.
- Flags ON: stream rendition when present, else master with `streamFallbackReason` logged.

Single `/api/library/stream` contract for client — hybrid is server-internal.

---

## Collector download → Master

`resolvePlaybackSrc` ~L226–228:

```javascript
if (userId && track.slug && access?.canStream) {
  const offline = getOfflinePlaybackUrl(userId, track.slug);
  if (offline) return offline;
}
```

- Runs **before** library stream redirect.
- Same `playTrackInternal` loads offline URL.
- Hybrid stream preference bypassed when offline hit — correct for downloaded masters.

---

## Analytics / stream sessions

Stream pipeline (`createStreamSession`, `insertStreamEvent`, `endStreamAnalytics`) activates only for entitled `/api/library/stream` plays. Preview CDN plays (guest) do not create stream sessions — by asset class, not separate player.

---

## Architecture cleanliness checklist

| Check | Status |
|-------|--------|
| Single client playback API | ✅ |
| Entitlement gates before stream URL emission | ✅ |
| Hybrid flags server-only | ✅ |
| Preview path independent of hybrid flags | ✅ |
| Offline master short-circuit documented | ✅ |
| Rollback = env vars OFF, no code path removal | ✅ |

---

## Section result

**PASS** — Guest→Preview, Entitled→Stream/Master, Collector offline→Master maps cleanly onto existing unified engine with server-side resolver layering.
