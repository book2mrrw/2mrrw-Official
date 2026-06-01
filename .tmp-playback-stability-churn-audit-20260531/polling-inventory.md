# Polling & Recurring Timer Inventory

Scope: `src/` production code. Classified by playback / account impact.

## setInterval sites (12 registrations in 10 files)

| ID | File | Interval | Lifetime | Purpose | Contexts touched | Required? | Redundant? | Rerender / playback |
|----|------|----------|----------|---------|------------------|-----------|------------|---------------------|
| P1 | `app/success/page.js` | 2000ms sleep loop (×7 max) | Mount of success page | Wait for webhook `ownedSlugs` | Auth | Partial | **High storm** with refreshAccountState each iter | Auth churn; no direct audio stop |
| P2 | `app/subscribe/page.js` | 2500ms ×5 | `?subscribed=1` effect | Poll subscription entitlement | Auth | Partial | Overlaps webhook + single refresh | Auth re-renders |
| P3 | `app/subscribe/page.js` | 2500ms ×5 | `handleSubscriptionSuccess` | Same as P2 | Auth | Partial | Duplicate pattern | Same |
| P4 | `context/AudioContext.js` | 15000ms | While playing | Save playback position server/local | Audio + user id | Yes | — | Low; no pause |
| P5 | `context/AudioContext.js` | 20000ms | While keep-alive active | SW keep-alive ping | SW only | Best-effort | — | None |
| P6 | `system/recovery/usePlaybackRecovery.js` | 5000ms | `hasStarted` | Persist queue snapshot to storage | Recovery store | Yes | Overlaps pagehide save | None |
| P7 | `app/page.js` | 1000ms | Mount (live countdown) | Live stream countdown UI | page local state | UI only | — | Full page tick re-render |
| P8 | `components/auth/AuthGate.js` | 500ms | OTP cooldown UI | Resend timer display | AuthGate | UI | — | Overlay only |
| P9 | `app/verify-otp/page.js` | 500ms | OTP cooldown | Same | verify-otp | UI | — | Route only |
| P10 | `components/music/CountdownTimer.js` | 1000ms | While mounted | Release countdown | Local | UI | — | Component only |
| P11 | `components/audio/PlayerControlButton.js` | rapid repeat | Hold seek | Seek while held | Audio seek | UX | — | Seek only |
| P12 | `context/AudioContext.js` | variable | Crossfade / swell | Track transition FX | Audio | UX | — | Brief pause/volume |

## setTimeout loops (non-interval polling)

| ID | File | Pattern | Purpose |
|----|------|---------|---------|
| T1 | `components/system/AudioPhase10Bridge.js` | 75ms retry ×40 max | Seek after recovery when loading |
| T2 | `hooks/sync/useRealtimeEvents.js` | reconnect delay | Realtime reconnect |
| T3 | `hooks/sync/useSyncEngine.js` | 250ms debounce + focus/visibility resync | Control-system data (not account/state) |
| T4 | `lib/vault-audio.js` | ~1.2s heartbeat fallback | Vault room audio |

## Account-sync polling summary

| Pattern | Max calls / visit | refreshAccountState per cycle |
|---------|-------------------|-------------------------------|
| Success page loop | 7 | 7 |
| Subscribe interval | 5 | 5 |
| Subscribe URL + modal success | 10 possible if both fire | 10 |

## Polling loop count (audit metric)

| Category | Count |
|----------|------:|
| **setInterval registrations in `src/`** | **12** |
| **Account/entitlement polling patterns** (P1–P3) | **3** |
| **Playback-persistence intervals** (P4–P6) | **3** |

## refreshLibrary pairing

Most account refreshes also call `refreshLibrary()` → second network round-trip updating overlapping `library` / `ownedSlugs` in both `library` state and `accountState`.
