# MASTER PLAYBACK ARCHITECTURE AUDIT (2026-05-28)

Scope executed as read-only deep trace across:
- Playback state machine integrity
- Mobile lifecycle + hydration resilience
- R2 + WAV streaming integrity
- Media session + queue synchronization

Key files deeply traced:
- `src/context/AudioContext.js`
- `src/lib/music-playback.js`
- `src/lib/playback/stream-client.js`
- `src/lib/music-access.js`
- `src/lib/commerce/entitlements.js`
- `src/app/api/library/stream/route.js`
- `src/components/audio/GlobalAudioPlayerBar.js`
- `src/components/preview/ImmersivePreviewModal.js`
- `src/app/page.js`
- `src/lib/control-system/playback.js`
- `src/lib/supabase/client.js`, `src/lib/supabase/server.js`, `src/lib/supabase/middleware.js`
- `src/context/AuthContext.js`
- `src/app/api/account/state/route.js`
- `public/sw.js`

Runtime corroboration:
- Live probe to production stream route without auth returned 401 HTML (no entitled-cookie context available in this run), so direct 206 verification from protected stream was blocked.
- Prior probe artifacts corroborate public preview R2 responses with `Accept-Ranges: bytes` and expected content-types:
  - `.tmp-features-no-audio-diagnostic-20260527/curl-probes.txt`
  - `.tmp-playback-performance-audit-20260527/raw-curl-probes.txt`

---

## Top 10 critical findings
1. Playback state transitions are not serialized; async branches can still write state after newer commands.
2. End-of-track flow uses delayed timeout-based transition, creating queue/repeat race windows.
3. Stream acquisition runs in dual modes (redirect path and JSON+HEAD path), causing divergent startup/error behavior.
4. Stream session lifecycle is not tightly coupled to actual playback confirmation.
5. Mobile visibility/app-transition recovery is best-effort and distributed, not orchestrated.
6. Entitlement updates and playback upgrades are loosely coupled via window events, allowing preview/full oscillation windows.
7. Queue authority is split between mutable refs and React state, increasing desync risk.
8. Media session metadata is updated from many paths, risking stale lock-screen state during rapid transitions.
9. Shared pause-interruption suppression flag is reused across unrelated operations and can mask valid state changes.
10. Auth/session hydration and playback lifecycle operate independently, increasing transition instability on mobile Safari/PWA.

---

## Audit conclusions by track
- **State machine integrity:** structurally improved but still vulnerable to branch races and timeout-driven transitions.
- **Mobile lifecycle/hydration:** resilient in common flows, but lacks deterministic orchestration for strict mobile app-switch conditions.
- **R2/WAV streaming:** core primitives are sound; architecture divergence between stream paths and session semantics is the main long-term risk.
- **Media session/queue sync:** strong feature coverage, but synchronization consistency depends on non-serialized control origins.

---

## Permanent remediation direction
- Adopt a command-serialized playback reducer as the sole state authority.
- Collapse stream acquisition into one canonical contract and one default path.
- Implement a unified lifecycle orchestrator for auth/access/playback transitions.
- Convert media session + queue updates to reducer-commit side effects only.

Detailed recommendations and priorities are in:
- `audit-1-state-machine.md`
- `audit-2-mobile-lifecycle-hydration.md`
- `audit-3-r2-wav-streaming.md`
- `audit-4-media-session-queue-sync.md`
- `race-conditions-matrix.md`
- `hidden-divergence-map.md`
- `prioritized-remediation-plan.md`
