# Phase 5.2.14 — Unified Playback Entitlement Validation

**Date:** 2026-05-31  
**Repository:** `/Users/recharge/artist-platform`  
**Mode:** Read-only audit — no code changes  
**Builds on:** Phase 5.2.12 (direct preview readiness), Phase 5.2.13 (direct preview implementation)

---

## Executive summary

All six scoped user types route through **one playback engine** (`AudioContext` + single `<audio>` element), **one queue** (`queueRef` / `setQueue` / `playQueue`), **one Media Session** (`updateMediaSession` + action handlers), and **one player chrome** (`GlobalAudioPlayerBar` via `useAudioPlayer`). Entitlement differences are resolved **upstream** in `resolveTrackAccess` → `resolvePlaybackSrc` / `catalogPreviewAudioUrl` (guest preview) vs `/api/library/stream` (entitled full). No alternate player, queue implementation, or Media Session stack exists per user type.

**Overall result: PASS**

One advisory client/server parity edge (collector ledger record without collector card) is documented in `architecture-forks.md` — it does **not** affect the six explicitly scoped user types when account state is aligned with `/api/account/state`.

---

## Section results

| # | Section | Result | Notes |
|---|---------|--------|-------|
| 1 | Entitlement matrix | **PASS** | Guest → preview CDN/API; entitled types → library stream (or offline master when cached) |
| 2 | Queue validation | **PASS** | setQueue / playNext / playPrevious / auto-advance / resume share identical paths; only `track.src` differs |
| 3 | Media Session | **PASS** | No entitlement branches in lock screen / background / car handlers |
| 4 | Direct preview flag | **PASS** | `DIRECT_PREVIEW_ENABLED` affects preview URL shape only; entitled stream path unchanged |
| 5 | Hybrid streaming future | **PASS** | Guest→preview, entitled→stream/master resolver is layered cleanly behind flags |
| 6 | Architecture review | **PASS** (1 advisory) | 7 entitlement-touched forks; 1 P2 client/server parity advisory; 6 expected preview/stream semantics |

---

## Success criteria check

| Criterion | Status |
|-----------|--------|
| One playback engine | ✅ `AudioContext.js` — single `<audio>` at ~L3174 |
| One queue | ✅ `setQueue` / `queueRef` — no per-tier queue |
| One media session | ✅ `navigator.mediaSession` wired once (~L2773–L2836) |
| One player | ✅ `GlobalAudioPlayerBar` + `useAudioPlayer` |
| Different resolved assets only | ✅ Preview vs stream resolved in `music-access.js` / `media-urls.js`; preview-only **behavior** (30s cap, seek cap) is asset-type semantics on the same engine |

---

## Fork count

**7** entitlement-touched forks in playback/queue/player logic (see `architecture-forks.md`):

- **1** P2 advisory (client `canStream` vs server `userCanStreamProduct` for collector ledger without card)
- **6** expected (preview hard cap, seek cap, stream→preview fallback, entitled preview-first upgrade, UI scrub cap, prewarm URL descriptor)

---

## Key findings

1. **Unified entry:** All catalog surfaces (`LatestSinglesStyleRow`, `CatalogGrid`, `AlbumTracklistSheet`, `ReleaseCardPlayButton`) call `toPlaybackTrack` / `albumTracksForPlayback` then `playQueue` / `playTrack` — never a tier-specific player.
2. **Guest isolation:** Guests never receive `/api/library/stream` URLs from `resolvePlaybackSrc` because `canRequestLibraryStream` requires `access.canStream` + aligned session userId.
3. **Server gate:** `/api/library/stream` enforces `userCanStreamProduct` (403) independent of client; admin bypass on both sides.
4. **Direct preview:** Phase 5.2.13 flag swaps preview URL origin (CDN vs `/api/media/preview` redirect) without touching entitled resolver or AudioContext queue logic.
5. **Hybrid-ready:** `resolve-playback-key.js` already branches master vs stream when `STREAM_PLAYBACK_PREFERRED`; defaults OFF preserve current master path.

---

## STOP

Validation complete. **No implementation.** No commits, pushes, or deploys.
