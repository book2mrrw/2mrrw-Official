# Full Modal + Audio Audit — 2026-05-26

## 1. Executive summary

The storefront uses **one music engine**: a hidden `<audio>` in `AudioContext` (`/Users/recharge/artist-platform/src/context/AudioContext.js`), mounted from root layout with `GlobalAudioPlayerBar`. Modals and cards are **UI adapters** (`useMediaEngine`, `useImmersivePlayback`, `PreviewPlayerControls`) — not separate players.

**Immersive singles/features** share `ImmersivePreviewModal` → `ModalShell` (`stackId="immersive-preview"`, z-index **8888**). Opening a modal **starts playback in the same user gesture** via `page.js` `openSingleModal` / `openFeatureModal` → `playTrack(toPlaybackTrack(...))`.

**Two playback modes on homepage:**
- **Mode 1 (inline):** `ReleaseCardPlayButton` → `playQueue` — no modal; `GlobalAudioPlayerBar` appears.
- **Mode 2 (immersive):** card/cover click → modal + sync `playTrack`.

**Albums** use a **legacy inline album modal** in `page.js` (also z **8888**, **not** `ModalShell`, **not** `modalStackStore`) plus optional `AlbumTracklistSheet` (z **9000**, on stack). Card ▶ on albums opens the **tracklist sheet**, not the album modal.

**Entitlements:** `/api/account/state` → `resolveTrackAccess` → `resolvePlaybackSrc` (preview CDN vs `/api/library/stream?redirect=1`). **30s hard cap** in engine; modal scrub UI caps at 30s for preview-only.

**Top risks:** tab **ambient `new Audio()`** loops can overlap music; **album modal** lacks stack scroll-lock coordination; **orphan `PreviewModalPlayer.js`**; concurrent stream **409**; My Music **Play** is inline-only unless user taps **Open/Tracklist**.

---

## 2. Modal file map + tree diagrams

### 2.1 File inventory

| Path | Role |
|------|------|
| `/Users/recharge/artist-platform/src/components/modal/ModalShell.js` | Shared immersive shell; framer-motion; `modalStackStore` |
| `/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js` | Single + feature immersive entry |
| `/Users/recharge/artist-platform/src/components/preview/immersive/*` (15 files) | Stage, panel, controls, atmosphere |
| `/Users/recharge/artist-platform/src/components/preview/PreviewEndedCTA.js` | Post-30s unlock CTA |
| `/Users/recharge/artist-platform/src/components/preview/PreviewModalPlayer.js` | **Orphan** — not imported in app tree |
| `/Users/recharge/artist-platform/src/components/music/AlbumTracklistSheet.js` | Album queue sheet |
| `/Users/recharge/artist-platform/src/state/ui/modalStackStore.js` | LIFO body scroll lock |
| `/Users/recharge/artist-platform/src/app/page.js` | Modal state, handlers, inline album modal |
| `/Users/recharge/artist-platform/src/components/gifts/GiftBottomSheet.js` | z 9500, on stack |
| `/Users/recharge/artist-platform/src/components/payments/DonateModal.js` | stack (per Phase reports) |
| `/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js` | Dock z 7600; stack when expanded |

### 2.2 Immersive preview component tree

```
page.js (previewModalOpen | featureModalOpen)
└─ AnimatePresence
   └─ ImmersivePreviewModal
      └─ ImmersiveErrorBoundary
         └─ ModalShell [stackId=immersive-preview, z=8888]
            ├─ PlayerAtmosphere
            └─ .modal-immersive-body
               └─ ImmersiveModalEnvironment
                  ├─ ImmersiveModalChrome (mobile only)
                  ├─ ImmersiveModalStage
                  │  ├─ ImmersiveModalScene / AtmosphericBackground / AmbientLighting
                  │  ├─ FloatingArtworkHero
                  │  ├─ PreviewPlayerControls [mobile, variant=floating]
                  │  ├─ FloatingViewMore (drawer)
                  │  └─ GlyphLyricsPanel
                  └─ ImmersiveModalPanel
                     ├─ TrackMeta
                     ├─ PreviewPlayerControls [desktop]
                     ├─ PreviewEndedCTA (conditional)
                     └─ ModalActionButtons
```

### 2.3 Album surfaces (two UIs)

```
CatalogGrid card click → openAlbumModal → playAlbumTracks(album, 0)
└─ page.js inline AnimatePresence album modal (z 8888, NO ModalShell)

CatalogGrid ▶ → onOpenAlbumTracklist → AlbumTracklistSheet (z 9000, stackId album-tracklist-sheet)
└─ playQueue → closes sheet; uses same AudioContext
```

### 2.4 Z-index stack (production)

| Layer | z-index | modalStackStore |
|-------|---------|-----------------|
| GlobalAudioPlayerBar | 7600 | when `expanded` |
| My Music sort sheet | 7000 | no |
| AlbumTracklistSheet | 9000 | yes |
| Immersive overlay (`.modal-immersive-overlay`) | 8888 | via ModalShell |
| Inline album modal (`page.js`) | 8888 | **no** |
| GiftBottomSheet | 9500 | yes |
| Membership upsell | 9998 | no |
| Stripe checkout | 9999 | yes (page.js effect) |
| Custom cursor | 99998–99999 | no |

Internal modal layers use relative z (0–24) in `globals.css` (chrome, float-player, drawer, glyphs).

### 2.5 Mobile vs desktop (immersive)

| Aspect | Mobile | Desktop |
|--------|--------|---------|
| Shell motion | Sheet-up drag dismiss | Center scale modal |
| Player UI | Floating `PreviewPlayerControls` on stage | Controls in `ImmersiveModalPanel` |
| Chrome | `ImmersiveModalChrome` + access badge | Close in panel |
| Layout | 62/38 stage/panel CSS | Stage + scroll panel |

---

## 3. Section-by-section playback matrix

| Section | Trigger | Modal? | Engine call | Source tag | Preview vs full |
|---------|---------|--------|-------------|------------|-----------------|
| **Home — Latest Singles row** | Card click | Yes (`openSingleModal`) | `playTrack` sync | `preview_modal` | `resolvePlaybackSrc` |
| **Home — Latest Singles row** | ▶ on card | No | `playQueue` | `home_single_card` | Same; 2s `upgradeToFullStream` if entitled |
| **Home — CarouselUI** | Cover overlay | Yes (`handleSingleClick` → modal) | via modal open | `preview_modal` | Label Listen/Preview from access |
| **Home — CarouselUI** | No ▶ on carousel | — | — | — | Cart/vinyl only |
| **Home — RadioCarousel** | ▶ | No | `playQueue` | `home_radio_carousel` | Inline |
| **Home — Features** | Cover | Yes (`openFeatureModal`) | `playTrack` sync | `feature_modal` | Same as singles |
| **Home — Features** | ▶ | No | `playQueue` | `home_feature_card` | Inline |
| **Home — Albums grid** | Card | Yes (legacy album modal) + `playAlbumTracks(0)` | `playQueue` or `playTrack` | `album_modal` | Per-track Play in modal if `canStream` |
| **Home — Albums ▶** | Play button | Sheet only | `playQueue` via sheet | `album_tracklist` | Opens `AlbumTracklistSheet` |
| **Music tab — Singles subtab** | Same as home carousel + features | Same | Same | Same | Duplicated UI block in `page.js` ~2053–2067 |
| **Music tab — Albums subtab** | Same as home albums | Same | Same | Same | |
| **My Music — singles rails** | Play | No | `playTrack` | `my_music` | Requires `canStream` |
| **My Music — singles** | Open | Yes | modal path | `preview_modal` | |
| **My Music — albums** | Play Album | No (queue only) | `playQueue` | `my_music_album` | |
| **My Music — albums** | Tracklist | Yes (`openAlbumModal`) | `playAlbumTracks(0)` | `album_modal` | |
| **Deep links** | `?deepLink=` song/album/feature | Routes to above | Same | Same | |

**Entitlement path (all sections):** `AuthContext` `accountState` from `/api/account/state` → `resolveTrackAccess` / `resolveContentAccess` → `toPlaybackTrack` → `resolvePlaybackSrc` → preview CDN or library stream redirect.

**Known behavioral notes:**
- Modal close (`closeSingleModal`, `closeFeatureModal`, `closeAlbumModal`) calls **`pause()`** (v2 fix).
- `authLoading` defers play via `modalPlaySlugRef` / `featureModalPlaySlugRef` + `useEffect` replay.
- `page.js` `nowPlaying` mini-player syncs for card playback when modals closed (not a second audio element).

---

## 4. Media engine architecture

```
UI (cards, modals, dock)
    ↓
useImmersivePlayback / useMediaEngine / useAudioPlayer
    ↓
AudioContext (single audioRef, playTrack, playQueue, preview cap, stream upgrade)
    ↓
resolvePlaybackSrc → preview CDN | /api/library/stream?redirect=1
    ↓
R2 signed GET (server) / public preview URLs

mediaEngineBridge ← registerMediaEngineBridge in AudioProvider
MediaEngine.js    ← imperative getState/subscribe (non-React)
```

**Duplicate audio elements (non-music-engine):**
- `page.js` tab ambient: `new Audio(src)` loops (volume 0.07) — **can overlap** global music.
- `AudioContext` CS preload / `MediaPreloader` / `vault-audio.js` — SFX/preload only.

**Relationship:** Confirmed **one** playback `<audio>` in `AudioProvider` (lines 1748–1753). Modals control it via `useMediaEngine().toggle/seek`, not local refs.

---

## 5. Bugs/risks by severity

| Severity | Issue |
|----------|--------|
| **High** | Tab ambient `new Audio()` in `page.js` (~879) not paused when global track plays — dual audio possible. |
| **High** | Album inline modal z 8888 **without** `modalStackStore` — scroll lock / stacking conflicts with immersive + sheets. |
| **Medium** | Concurrent stream **409** — second device blocks playback (`streamConflict` in bar). |
| **Medium** | `PreviewModalPlayer.js` dead code — confusion for future edits. |
| **Medium** | Album card ▶ opens tracklist sheet; card body opens album modal — **inconsistent** UX. |
| **Low** | DonateModal / AuthGate / membership upsell not on `modalStackStore` (documented deferrals). |
| **Low** | My Music sort sheet z 7000 under player 7600 — may be obscured when player expanded. |
| **Low** | `subscription` gate requires `permissions.subscriber` — edge cases if account state lags webhooks. |

---

## 6. Gaps vs platform rules

| Rule | Status |
|------|--------|
| Entitlements from backend, not UI toggles | **OK** — `resolveTrackAccess` uses `accountState` |
| Single User + permissions model | **OK** |
| No UI redesign | Audit is read-only |
| `modalStackStore` for modals | **Partial** — immersive + album sheet + gift + player expanded; **album modal, upsell, sort sheet** excluded |
| Production media via CDN/signed, not local | **OK** for playback paths reviewed |
| Protected `page.js` | Modal/audio handlers live here — high coupling |

---

## 7. Manual QA checklist

- [ ] Guest: card ▶ on single — plays 30s preview, global bar visible, no modal.
- [ ] Guest: single card body — modal opens, audio starts, scrub capped at 30s, `PreviewEndedCTA` at end.
- [ ] Close immersive modal — audio **stops**.
- [ ] Subscriber with permission — full stream via redirect; card ▶ upgrades after ~2s.
- [ ] Subscriber without `permissions.subscriber` — preview only.
- [ ] Feature cover vs ▶ — modal vs inline respectively.
- [ ] Album card — modal + track 1 plays; close overlay — pause.
- [ ] Album ▶ — tracklist sheet only; Play All / track row — queue + sheet closes.
- [ ] My Music Play vs Open — inline vs immersive.
- [ ] My Music Play Album — queue without modal unless Tracklist.
- [ ] Auth loading: open modal before account ready — deferred play fires.
- [ ] Switch music tabs with ambient tab audio — no double audio.
- [ ] Expanded global player + open immersive — scroll lock sane.
- [ ] Second device stream — 409 messaging in bar.

---

## Manifest (files read for this audit)

```
/Users/recharge/artist-platform/src/state/ui/modalStackStore.js
/Users/recharge/artist-platform/src/components/modal/ModalShell.js
/Users/recharge/artist-platform/src/components/preview/ImmersivePreviewModal.js
/Users/recharge/artist-platform/src/components/preview/PreviewEndedCTA.js
/Users/recharge/artist-platform/src/components/preview/PreviewModalPlayer.js
/Users/recharge/artist-platform/src/components/preview/immersive/* (all 15)
/Users/recharge/artist-platform/src/components/music/AlbumTracklistSheet.js
/Users/recharge/artist-platform/src/components/music/ReleaseCardPlayButton.js
/Users/recharge/artist-platform/src/components/music/MyMusicTab.js
/Users/recharge/artist-platform/src/components/home/FeaturesRail.js
/Users/recharge/artist-platform/src/components/home/RadioCarousel.js
/Users/recharge/artist-platform/src/components/home/CarouselUI.js
/Users/recharge/artist-platform/src/components/home/CatalogGrid.js
/Users/recharge/artist-platform/src/components/audio/GlobalAudioPlayerBar.js
/Users/recharge/artist-platform/src/context/AudioContext.js (partial)
/Users/recharge/artist-platform/src/lib/player/useImmersivePlayback.js
/Users/recharge/artist-platform/src/lib/music-playback.js
/Users/recharge/artist-platform/src/lib/music-access.js
/Users/recharge/artist-platform/src/media/useMediaEngine.js
/Users/recharge/artist-platform/src/media/mediaEngineBridge.js
/Users/recharge/artist-platform/src/media/MediaEngine.js
/Users/recharge/artist-platform/src/app/page.js (modal/audio sections)
/Users/recharge/artist-platform/src/app/globals.css (z-index excerpts)
/Users/recharge/artist-platform/docs/reports/audio-system-full-audit-20260525.md
/Users/recharge/artist-platform/docs/reports/audio-modal-unified-fix-20260526.md
```

**Related reports to bundle in zip:** `audio-system-full-audit-20260525.md`, `audio-modal-unified-fix-20260526.md`, `audio-logic-audit-20260525.md`, `audio-logic-fix-20260525.md`, `manifest-audio-audit.txt`.

---

## Top 5 findings

1. **Single engine is real** — one `<audio>` in `AudioContext`; modals/dock use `useMediaEngine` / `PreviewPlayerControls`, not separate players (legacy audits about `modalAudioRef` are outdated).

2. **Immersive path is unified** — singles and features share `ImmersivePreviewModal` + `ModalShell`; sync play + auth-deferred replay in `page.js`.

3. **Album UX is split** — legacy `page.js` album modal (plays on open, not on stack) vs `AlbumTracklistSheet` for card ▶; easy to confuse with immersive singles.

4. **Ambient tab audio risk** — `page.js` `new Audio()` loops can run alongside catalog playback (high-severity overlap).

5. **Stack/z-index debt** — immersive 8888, sheet 9000, player 7600, gift 9500; album modal and several overlays bypass `modalStackStore`.
