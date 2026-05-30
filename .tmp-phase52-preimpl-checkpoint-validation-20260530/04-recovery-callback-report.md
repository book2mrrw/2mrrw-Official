# 04 — Recovery Callback Report

**Phase:** 5.2 Pre-Implementation Checkpoint Validation  
**Date:** 2026-05-30  
**Mode:** Read-only audit

---

## Verdict: **CONDITIONAL PASS**

Client-side recovery callbacks restore **playback queue state** across tab reloads without downtime. **Entitlements, resolver logic, and ownership** are server-authoritative and re-hydrate on every session via `/api/account/state` — not via recovery callbacks. Full rollback to pre-Phase-5.2 **application** state requires git checkout + redeploy (brief deploy window), not callback-only restore.

---

## Recovery callback inventory

| Module | Path | Purpose |
|--------|------|---------|
| Recovery store | `src/system/recovery/recoveryStore.js` | sessionStorage `2mrrw:recovery:*` v1 |
| Session orchestrator | `src/system/recovery/useSessionRecovery.js` | Mount: load playback → hydrate → refresh URLs → dispatch event |
| Playback persistence | `src/system/recovery/usePlaybackRecovery.js` | Save queue IDs, index, currentTime every 5s |
| Signed URL refresh | `src/system/recovery/signedUrlRefresher.js` | Refresh presigned URLs for current + next 2 tracks |
| Track hydration | `src/system/recovery/useTrackHydration.js` | Re-fetch metadata for recovered IDs |
| Immersive recovery | `src/system/recovery/useImmersiveRecovery.js` | Modal/immersive player state |
| Scroll recovery | `src/system/recovery/useScrollRecovery.js` | Scroll position restore |
| Session root | `src/components/system/SessionRecoveryRoot.js` | Wires session + scroll recovery |
| Audio bridge | `src/components/system/AudioPhase10Bridge.js` | Listens `2mrrw:playback-recovery` → `setQueue` + seek |
| Catalog hydrate API | `src/app/api/catalog/hydrate/route.js` | Maps queue IDs → playback metadata |
| Admin fulfill recovery | `src/app/api/admin/fulfill-recovery/route.js` | Commerce fulfillment recovery (admin) |

**Event contract:** `window.dispatchEvent(new CustomEvent("2mrrw:playback-recovery", { detail }))`

---

## Per-domain restore capability

| Domain | Callback restores? | Server restore? | Zero-downtime? |
|--------|---------------------|-----------------|----------------|
| **Playback queue** | ✅ sessionStorage + event | N/A | ✅ Tab reload only |
| **Playback position** | ✅ currentTime + seek retry | N/A | ✅ |
| **Signed stream URLs** | ✅ refresh on recovery | Re-resolve on play | ✅ |
| **Entitlements** | ❌ | ✅ `/api/account/state` | ✅ (no deploy) |
| **Resolver behavior** | ❌ | ✅ Deployed code | ❌ Requires redeploy to revert |
| **Ownership / library** | ❌ | ✅ Supabase + account state | ✅ (no deploy) |
| **Collector / vault** | ❌ | ✅ DB + APIs | ✅ |

---

## Pre-Phase-5.2 restore scenarios

### Scenario A — Tab reload (no Phase 5.2 deployed)

1. `usePlaybackRecovery` persisted queue to sessionStorage
2. `useSessionRecovery` loads snapshot → `/api/catalog/hydrate` → signed URL refresh
3. `AudioPhase10Bridge` applies queue + seek
4. Entitlements unchanged — already in `AuthContext` from account state

**Result:** ✅ Playback restored without downtime; no Phase 5.2 involvement.

### Scenario B — Phase 5.2 deployed, rollback via flag

1. Set `STREAM_PLAYBACK_PREFERRED=0` (when implemented)
2. Resolver skips stream discovery → master paths
3. Client callbacks unchanged
4. No data restore required

**Result:** ✅ Designed <5 min env propagate; callbacks compatible (Phase 5.1 design).

### Scenario C — Revert resolver code to `23f77e4`

1. `git checkout 23f77e4` + redeploy
2. Brief deploy window (~minutes)
3. Account state + ownership unaffected (server DB)
4. Session callbacks may re-hydrate against reverted resolver

**Result:** ⚠️ Not zero-downtime; acceptable for emergency rollback.

### Scenario D — Full `npm run recover:foundation`

1. Checks out anchor `48f97dd` / `0866f99` (older than Phase 4.8)
2. Would **lose** Phase 4.8 playback fast-path unless anchor promoted first

**Result:** ❌ Misaligned anchor risks regressing past intended checkpoint.

---

## Callback limitations

1. **sessionStorage only** — cleared on browser data wipe; not cross-device
2. **Hydrate fallback** — `/api/catalog/hydrate` may return `{ title: "Restored" }` if control-system miss
3. **No entitlement callback** — by design (platform-architecture rule)
4. **No resolver version pin** — callbacks always use live deployed API

---

## Can restore playback, entitlement, resolver, ownership to PRE-PHASE-5.2 without downtime?

| Component | Without downtime? | Method |
|-----------|-------------------|--------|
| Playback (in-session) | ✅ | Recovery callbacks |
| Entitlement | ✅ | Already server-side; no 5.2 change yet |
| Ownership | ✅ | DB unchanged |
| Resolver (code) | ❌* | Git redeploy required |
| Combined pre-5.2 stack | ⚠️ | *Phase 5.2 not implemented — current HEAD **is** pre-5.2 |

**Today (pre-implementation):** HEAD is already pre-Phase-5.2 for streaming. No rollback needed.

**Post-5.2:** Flag-off rollback designed for zero data migration; deploy still needed for code revert if flags insufficient.

---

## Layer conclusion

| Criterion | Result |
|-----------|--------|
| Playback callback chain wired | ✅ |
| Entitlement/ownership server-restored | ✅ |
| Resolver rollback without deploy | ❌ (flag-only when implemented) |
| Misaligned git anchor risks wrong restore | ⚠️ |

**Recovery Callback Validation: CONDITIONAL PASS**

*Condition: Distinguish session playback recovery (pass) from full application rollback (requires anchor promotion + deploy).*
