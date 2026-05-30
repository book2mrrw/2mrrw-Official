# Playback Eligibility Flow

## End-to-End Flow

1. UI computes access via `resolveTrackAccess` / `resolveContentAccess`.
2. Playback item chooses:
   - full stream: `/api/library/stream?slug=...&redirect=1`
   - preview: preview CDN/public URL
3. `AudioContext` executes play:
   - if stream URL is symbolic, resolves signed URL via `fetchLibraryStream`
   - keeps session metadata for refresh/end analytics
4. API `/api/library/stream` enforces entitlement with `userCanStreamProduct`.
5. If denied/unavailable:
   - frontend may fall back to preview (depending on status and entitlement context)
   - preview hard-capped at 30 seconds in player logic

## How Entitlements Propagate into Playback

- `accountState` -> `resolveTrackAccess` -> track `metadata.access` -> `AudioContext` behavior.
- On updated entitlements, `entitlements:updated` event can trigger `upgradeToFullStream` if currently previewing.
- Backend remains final authority; client access only influences UX path.

## Feature vs Single Ownership

- Access helper treats slug and albumSlug as ownership candidates.
- `isDigitalProduct` includes `single`, `album`, `ep`, `feature`, etc., enabling full-catalog injection for eligible subscribers/collectors/admins.
- This supports feature-track streaming under same digital eligibility path, but relies on correct slug mapping.

## Purchased-Track Persistence

- Permanent sources (purchase/gift/grant/collector_unlock) are treated as durable ownership.
- Subscription-derived rows are virtual/transient and should not overwrite permanent ownership.

## Mismatch Risks

- UI says streamable, API denies: possible during stale account-state or mixed-flag conditions.
- UI says preview-only, API would allow: possible before account refresh after purchase/activation.
- Runtime mitigates by attempting stream and fallback/upgrade, but behavior depends on event timing.
