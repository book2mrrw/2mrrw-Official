# Entitlement Propagation Map

## Decision Graph (Source -> Playback)

1. **Source of record (DB / auth)**
   - Auth/session cookies + Supabase session
   - Tables: `user_entitlements`, `entitlements`, `memberships`, `collector_ownerships`, `vault_entitlements`, `library_items`
2. **Backend composition**
   - `/api/account/state` composes:
     - `library`, `ownedSlugs`, `membership`, `collectorOwnerships`, `permissions`, `userEntitlements`
     - virtual catalog projection for subscriber/collector/admin
3. **Frontend hydration**
   - `AuthContext.refreshAccountState()` fetches `no-store`
   - payload normalized into `accountState`
4. **Frontend policy evaluation**
   - `resolveTrackAccess` / `resolveContentAccess` derive `canStream`, `previewOnly`, `showPrice`, etc.
5. **Track construction**
   - `toPlaybackTrack` / `normalizeTrackForPlayback` set `src`:
     - full stream -> `/api/library/stream?slug=...&redirect=1`
     - preview -> public preview URL
6. **Playback runtime**
   - `AudioContext.playTrack` fetches signed stream URL when needed
   - runtime fallback to preview on denial/unavailable states
7. **Authoritative enforcement**
   - `/api/library/stream` calls `userCanStreamProduct` and can deny (401/403), regardless of client optimism

## Where Entitlements Enter UI

- Home page cards/modals call `resolveContentAccess` / `resolveTrackAccess`.
- My Music collection and playlists also gate by same helpers.
- Plus/add-to-library/playlist actions are disabled when `canStream` false.
- Price/cart visibility depends on `showPrice/showCart` from content access helper.

## Propagation Timing

- Triggered by sign-in/session restore, manual refresh calls, purchase success, gift flows, collector activation, auth events.
- Additional client event: `window.dispatchEvent("entitlements:updated")` used by audio runtime to upgrade preview -> full stream.
