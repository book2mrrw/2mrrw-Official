# 05 — Playback Compatibility

**Validates:** Queue, Media Session, background audio, mobile Safari/Chrome iOS under hybrid stream renditions.

---

## Client playback path (unchanged contract)

| Layer | Module | Hybrid change |
|-------|--------|---------------|
| Access | `resolveTrackAccess()` — `music-access.js` | None |
| URL | `resolvePlaybackSrc()` → `libraryStreamRedirectSrc()` | None — still `redirect=1` |
| Play command | `AudioContext` command queue | None |
| Audio element | Single global `<audio>` | None |
| API | `GET /api/library/stream?redirect=1` | Smaller proxied object |

```224:237:src/lib/music-access.js
export function resolvePlaybackSrc(track, access, { userId, accountState } = {}) {
  // ...
  if (canRequestLibraryStream(access, { userId, accountState }) && track.slug) {
    return libraryStreamRedirectSrc(track.slug, { trackSlug });
  }
  // preview CDN for guests
}
```

**Validation:** ✅ Zero client changes required for MVP.

---

## Queue & continuity

| Feature | Implementation | Hybrid impact |
|---------|----------------|---------------|
| Queue array | `AudioContext` state `queue`, `queueIndex` | None |
| Next/previous track | Command queue advances slug | New resolve per track — stream key per entity |
| Repeat / shuffle | Client state only | None |
| Gapless albums | Single-file sequential | AAC files OK; HLS optional 5e for gapless |
| Crossfade / CS mode | `csAudio` alternate src | Independent of stream layer |
| Offline cache | `getOfflinePlaybackUrl()` — `music-access.js` L227 | Re-cache on next online play (smaller file = faster) |

**Overlap tracks** (e.g. `w2d` as single + album track): Each play resolves by `slug` + optional `trackSlug` — separate stream files per folder.

---

## Media Session & background audio

| Capability | Location | AAC stream compat |
|------------|----------|-------------------|
| Lock screen metadata | `AudioContext` Media Session API | ✅ AAC in MP4 supported |
| Background play | iOS requires user gesture + single audio | ✅ Unchanged |
| Dynamic Island | Same metadata pipeline | ✅ |
| Bluetooth / CarPlay | System decodes AAC | ✅ Industry standard |
| Interruption handling | OS audio takeover | ✅ No second `<audio>` |

Platform guardrail preserved: one `<audio>` element, no duplicate players.

---

## Mobile Safari & Chrome iOS

### Format support

| Format | iOS Safari `<audio>` | Android Chrome |
|--------|:--------------------:|:--------------:|
| AAC-LC in `.m4a` | ✅ Native | ✅ |
| WAV PCM | ✅ (large buffer) | ✅ |
| FLAC | Limited / large | ✅ |
| HLS | ✅ via `<audio src>` or native HLS | ✅ |

**Hybrid win:** AAC reduces `playback-src-to-first-byte` vs WAV — **projection** 20–40% tap→audible improvement when CDN/proxy bound.

### Measured baselines (Phase 4.7–4.8)

| Metric | Value | Label |
|--------|-------|-------|
| Preview CDN range TTFB | 954 ms | **Measured** |
| Stream redirect TTFB (401) | 279–804 ms prod; 3–9 ms warm local | **Measured** |
| Tap→audible entitled | 300–1200 ms | **Projection** (Phase 4.5) |
| Preview API warm | ~4 ms | **Measured** (Phase 4.8) |

### iOS-specific behaviors

| Behavior | Risk with hybrid | Mitigation |
|----------|------------------|------------|
| Low Power Mode | Large WAV stalls | Smaller AAC — **projection** lower stall |
| WebAudio unlock | Pre-play gesture | Unchanged (4.8 mobile cover defer) |
| PWA standalone | `isStandalonePwa()` checks | Unchanged |
| Preview fallback on error | `AudioContext` L1209–1241 | Still works if stream 403/404 |

Phase 4.8: cover preload deferred to `canplay` on mobile — preserved independent of format.

---

## Error & retry paths

```mermaid
flowchart TD
  Tap[User tap play] --> Stream[/api/library/stream redirect=1]
  Stream -->|200 AAC| Play[audio.play]
  Stream -->|401/403 entitled| PreviewFallback[preview CDN]
  Stream -->|404| Error[streamRetryable UI]
  Stream -->|master fallback| Master[WAV via same proxy]
```

| Error | Current | Hybrid |
|-------|---------|--------|
| No stream, master exists | N/A | Master via fallback — higher latency |
| No stream, no master | Preview or 404 | Same |
| Corrupt stream | Decode error | Denylist slug; master fallback |

---

## Performance projections

| Segment | Master WAV | AAC stream | Confidence |
|---------|------------|------------|------------|
| First 64 KiB download | ~64 KB PCM | ~64 KB AAC priming | High (smaller effective decode) |
| Full track egress | ~35 MB | ~3.3 MB | High (arithmetic) |
| `canplay` wait | Higher buffer | Lower buffer | Medium |
| Proxy function duration | Longer | Shorter | Medium |

---

## Phase 4.x lock compliance

Per Phase 4.8 architecture lock — hybrid must **not** regress:

- ✅ Single `<audio>`, command queue
- ✅ `redirect=1` entitled path
- ✅ Server-Timing segments
- ✅ Playback key + stream URL caches
- ✅ Preview fast path for guests

---

## Validation checklist (post-implementation)

- [ ] iOS Safari `dumpPlaybackTiming()` entitled stream 200
- [ ] Lock screen title/artwork during AAC play
- [ ] Background 10+ min without stall
- [ ] Queue advance across album tracks (love-hz-vol-1)
- [ ] Bluetooth disconnect/reconnect
- [ ] Compare tap→audible vs master baseline HAR

---

## Verdict

**Playback compatibility:** **High** — AAC-LC in existing proxy pipeline; no client or Media Session changes. Pending device validation after transcode backfill.
