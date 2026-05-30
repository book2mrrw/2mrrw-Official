# Entitlement Architecture Audit (Read-Only)

Date: 2026-05-28  
Scope: entitlement source-of-truth, propagation, playback enforcement, session/cache behavior

## Executive Verdict

**Verdict: Distributed (not centralized)**  
**Confidence: 0.91**

The codebase has a strong backend entitlement core (`user_entitlements`, `entitlements`, membership/collector tables, `/api/account/state`, `/api/library/stream`), but business rules are duplicated and re-derived in several layers:
- backend API composition and fallback derivation
- frontend access resolution (`resolveTrackAccess`, `resolveContentAccess`)
- playback runtime fallback and upgrade logic
- local library/playlist gating based on client state

This creates multiple decision points for the same policy, with moderate drift risk under edge states (session staleness, entitlement updates, cross-device lag).

## Top 10 Architectural Risks

1. **Policy duplication drift** between `/api/account/state` and `resolveTrackAccess` can produce UI/full-access optimism while stream API denies.  
2. **`subscriber` logic over-constrains playback** in client (`permissions.subscriber` + `subscriberActive`) while backend uses membership/entitlement checks; mismatch risk when one flag lags.  
3. **Collector inference is multi-source** (`collector_card` entitlement, collector ownership rows, legacy slug heuristics), creating inconsistent truth under partial data.  
4. **Admin checks are repeated** in route, account payload, and frontend helper paths; any future admin-role shape change can desync behavior.  
5. **Legacy fallback paths** (`library_items`, `collector_access`, missing-table fallbacks) keep compatibility but increase branching and policy ambiguity.  
6. **Client-side playlist/library gating uses local storage state** (`isInLibrary`, local playlists), which is not authoritative and can diverge from server entitlements.  
7. **Entitlement update propagation is event-driven + manual** (`entitlements:updated`, explicit refresh calls), so missed events can leave stale preview/full mode in UI.  
8. **Cross-device sync latency** depends on fetch cadence and manual refresh, not push invalidation; newly granted purchases may not instantly reflect on another device.  
9. **Guest and authenticated identity interleaving** can preserve previous user/admin state in edge transitions (defensive logic exists, but complexity is high).  
10. **Stream session/concurrency semantics are partly bypassed** (active sessions cleared before create), reducing strict single-session enforcement clarity.

## Recommended Consolidation Plan (No Code Changes Applied)

1. **Define one canonical entitlement contract** from backend (single schema for owned/subscriber/collector/admin/preview flags per slug).  
2. **Move access decisions to backend-computed per-item fields** in `/api/account/state` (or dedicated entitlement endpoint), with frontend as pure renderer.  
3. **Refactor frontend `resolveTrackAccess` to adapter-only** (consume backend flags, no independent policy derivation).  
4. **Unify collector resolution** into one source table/view and retire slug/status heuristics once migrated.  
5. **Separate permanent ownership vs transient streaming access explicitly** in API payload to avoid source-name interpretation spread.  
6. **Centralize admin override policy** in one shared backend helper used by all route handlers and account payload builders.  
7. **Introduce entitlement versioning (`entitlements_version`)** and force refresh when version changes to reduce stale-device states.  
8. **Standardize cache invalidation triggers** after purchase/gift/subscription changes (single event + server version bump).  
9. **Align stream API and account-state policy modules** (both call same policy evaluator).  
10. **Document and deprecate legacy fallback branches** with migration checkpoints and telemetry.

## Artifact Index

- `role-hierarchy-and-inheritance.md`
- `entitlement-propagation-map.md`
- `duplication-matrix.md`
- `playback-eligibility-flow.md`
- `mobile-auth-and-session-sync.md`
- `cache-and-invalidation.md`
- `risks-and-scalability.md`
- `manifest.txt`
