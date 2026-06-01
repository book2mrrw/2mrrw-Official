# Architecture Forks — Entitlement Branches in Playback Logic

**Phase 5.2.14** | Ranked fork inventory

---

## Summary

| Rank | Count | Description |
|------|-------|-------------|
| P1 Critical | 0 | Separate player/queue/session per tier |
| P2 Moderate | 1 | Client/server canStream parity edge |
| P3 Expected | 4 | Preview asset semantics on unified engine |
| P4 Low | 2 | Entitled optimization + UI cap on same engine |
| **Total** | **7** | Entitlement-touched forks |

**No P1 forks.** Unified engine criterion holds.

---

## P2 — Moderate (advisory)

### Fork #1 — Client `canStream` vs server `userCanStreamProduct` (collector ledger without card)

| | |
|--|--|
| **Location** | `music-access.js` L179 vs `commerce/entitlements.js` L103–115 |
| **Client** | `canStreamFull = owned \|\| isSubscriber \|\| collectorCardOwner` — does **not** include per-track `collector` flag |
| **Server** | `userCanStreamProduct` grants catalog stream when `membershipHasPremiumAccess \|\| collector.hasCollectorAccess` |
| **Impact** | User with active `collector_ownerships` record but **no** collector card: server may 200 stream while client resolves preview URL |
| **Scoped user types** | Does **not** affect **Collector Card Owner** (explicit scope) when `accountState.collectorCard` is true |
| **Playback engine** | Same engine — wrong **asset** if mismatch occurs |
| **Recommendation** | Align client `canStreamFull` with server or document per-track collector as badge-only (future phase) |

---

## P3 — Expected preview/stream semantics (same engine)

### Fork #2 — Preview 30s hard cap and fade

| | |
|--|--|
| **Location** | `AudioContext.js` ~L1083–L1108, ~L1146–L1153 |
| **Trigger** | `track.metadata.access.previewOnly` |
| **Behavior** | Fade, stop at 30s, `ended_preview` state, `preview:ended` event |
| **Verdict** | ✅ Asset-type behavior for preview clips — not a separate player |

### Fork #3 — Seek cap for preview

| | |
|--|--|
| **Location** | `AudioContext.js` `seekInternal` ~L2499; `GlobalAudioPlayerBar` scrub ~L65–L88 |
| **Trigger** | `previewOnly` |
| **Behavior** | Seek clamped to `PREVIEW_HARD_CAP_SEC` (30) |
| **Verdict** | ✅ Expected preview UX on same element |

### Fork #4 — Stream fetch error → preview fallback

| | |
|--|--|
| **Location** | `AudioContext.js` ~L1314–L1352, ~L1657–L1694, `applyStreamResolveError` |
| **Trigger** | 401/404/403 when `!entitled` or transient errors |
| **Behavior** | Loads `getTrackPreviewSrc(track)`; patches `previewOnly: true` on currentTrack |
| **Verdict** | ✅ Resilience path — still `playTrackInternal` |

### Fork #5 — Guest stream URL swap at play time

| | |
|--|--|
| **Location** | `AudioContext.js` ~L1643–L1651 |
| **Trigger** | `usesLibraryStream && !entitledFullStream && previewSrc` |
| **Behavior** | Replaces library stream redirect in `syncSrc` with preview URL before load |
| **Verdict** | ✅ Safety if queue item carried stream-shaped URL with guest access metadata |

---

## P4 — Low impact

### Fork #6 — `upgradeToFullStream` preview-first entitled path

| | |
|--|--|
| **Location** | `AudioContext.js` ~L2075–L2160; `ReleaseCardPlayButton` ~L67–L72 |
| **Trigger** | `canStream && previewOnly` mismatch (e.g. auth hydration lag) |
| **Behavior** | Mid-playback swap to signed stream; clears previewOnly |
| **Verdict** | ✅ Same engine — entitlement **upgrade**, not fork |

### Fork #7 — Library tab UI gate before play

| | |
|--|--|
| **Location** | `MyMusicTab.js` ~L560, ~L570 |
| **Trigger** | `!resolvedAccess?.canStream` |
| **Behavior** | Returns before `playTrack` — entry point only |
| **Verdict** | ✅ UI gate; engine unchanged when play proceeds |

---

## Non-forks (explicitly excluded)

| Pattern | Why not a problematic fork |
|---------|---------------------------|
| `resolvePlaybackSrc` preview vs stream URL | **Intended** asset resolution layer |
| `/api/library/stream` 403 for guests | Server authorization — not client player fork |
| `MyMusicTab` disabled buttons | UI affordance — same hook |
| `CarouselUI` "Listen" vs "Preview" label | Copy only |
| `MediaPreloader` / vault ambient `new Audio()` | Warm/prototype elements — not playback engine |
| `useMediaEngine` | Subscription adapter over same AudioContext |

---

## Entry-point consistency

All primary play surfaces converge:

```text
toPlaybackTrack / albumTracksForPlayback
  → playQueue / playTrack (AudioContext)
  → playTrackInternal
  → single <audio>
```

No surface invokes a tier-specific player module.

---

## Ranked action items (validation only — not implemented)

1. **P2:** Reconcile collector ledger `canStream` client vs server if per-track collector streaming is product-intent.
2. **P4:** Monitor `needsPreviewUpgrade` timer frequency in production metrics (optional).

---

## Section result

**PASS** with **1 advisory P2 fork**. No entitlement-based alternate playback engine, queue, or Media Session stack.
