# Audit 2: Mobile Lifecycle + Hydration Resilience

## 1) Confirmed problems
- Playback start path on mobile includes async boundaries before definitive `audio.play()` in multiple branches (`src/context/AudioContext.js` gesture unlock, stream resolve, src swap, retry flows).
- Visibility restore logic is branchy by platform and may downgrade to paused state without consistent replay of user intent (`src/context/AudioContext.js` visibility/pagehide/pageshow handlers).
- Service worker keep-alive is message-only and does not provide stream continuity or offline buffering guarantees (`public/sw.js`).
- Auth/account hydration and media progress hydration are asynchronous and can lag playback entitlement state (`src/context/AuthContext.js`, `src/app/api/account/state/route.js`).

## 2) Potential future risks
- Mobile Safari policy shifts can break current best-effort resume behavior.
- More modal entry points increase remount/hydration complexity unless centralized.

## 3) Race conditions
- **RC-4:** `entitlements:updated` event may trigger `upgradeToFullStream` while active stream retry or play request is in-flight.
- **RC-5:** Auth refresh and account-state refresh can lag UI action, producing transient preview/full mismatches.

## 4) Mobile-specific risks
- iOS-specific paused fallback in visibility return path can cause "state says playing, element paused" transitions.
- Touch-driven CS hold interactions in global bar create extra source/playback-rate mutations during mobile gestures.

## 5) App-transition risks
- App switch/background/foreground relies on visibility and pageshow listeners, not explicit persisted command journal.
- PWA standalone path does not add stronger lifecycle recovery semantics than browser tab path.

## 6) Hidden architectural divergence
- Playback lifecycle policy is distributed across `AudioContext`, `GlobalAudioPlayerBar`, `ImmersivePreviewModal`, `page.js`, and auth/session layers.

## 7) Memory leak risks
- Multiple window/document listeners in `AudioContext` and page-level logic increase leak surface during repeated remount in development/strict conditions.

## 8) Hydration/remount risks
- `page.js` rehydrates many UI states and can continue toggling playback-related overlays while audio state is still recovering.
- Modal stack registration is independent from playback restoration, allowing UI/player mismatch after route transitions.

## 9) Async-flow instability
- Session restore (`supabase.auth.getSession` + localStorage fallback) and playback recovery are parallel concerns without orchestrated sequencing.

## 10) Exact file-level remediation recommendations
- Establish a single mobile lifecycle orchestrator with explicit phases: `backgrounding`, `foregrounding`, `reacquiring_stream`, `restored`:
  - `src/context/AudioContext.js`
  - `src/context/AuthContext.js`
  - `src/app/page.js`
- Add durable playback intent persistence (command journal) and deterministic replay on visibility/pageshow:
  - `src/context/AudioContext.js`
  - `src/lib/media-session-artwork.js` (expand beyond metadata persistence)
- Consolidate modal-triggered play/toggle entrypoints behind one dispatcher:
  - `src/components/preview/ImmersivePreviewModal.js`
  - `src/app/page.js`
- Upgrade SW role from keep-alive ping-only to lifecycle-aware telemetry/heartbeat proxy (without owning stream fetch):
  - `public/sw.js`
  - `src/app/layout.js`

## 11) Priority (critical/high/medium/low)
- **Critical:** mobile lifecycle orchestrator + deterministic replay.
- **High:** unified playback dispatcher for modal/page/global controls.
- **Medium:** SW lifecycle instrumentation and hydration ordering hardening.
- **Low:** cosmetic refactors of ancillary listeners.
