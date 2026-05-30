# 06 — Entitlements

## Server (authoritative)

**File:** `src/lib/commerce/entitlements.js` — `userCanStreamProduct(userId, slug)`

Allows stream when:
- Admin user
- `userOwnsProduct` (purchase/gift)
- Active membership **or** collector access **and** product is digital (`isDigitalProduct`)

**API:** `src/app/api/library/stream/route.js` — 401 no session, 403 `userCanStreamProduct` false, 404 no product/key.

## Client (UI gating only)

**File:** `src/lib/music-access.js` — `resolveTrackAccess`

- `canStream` true → `resolvePlaybackSrc` uses `libraryStreamRedirectSrc` or stream URL
- `previewOnly` → public preview CDN only
- Sources: owned slugs, library purchase rows, `subscriberActive` + `permissions.subscriber`, collector card

**Must not** override server — client preview when server would 403 still shows UI but stream fails on full play.

## Feature vs single

Same entitlement rules; feature `product_type: "feature"` is digital if in `products` table.

## Album entitlement gap

- Card play may use **album slug** for stream
- `userCanStreamProduct` checks product slug — album product must exist
- Per-track play via `resolveAlbumTrackStreamSlug` may pass album slug when track has no catalog slug → stream uses album-level asset only

## Guest

- Previews: public CDN (no auth)
- Full: 401 on `/api/library/stream`

## Failure matrix

| Symptom | Layer |
|---------|-------|
| Preview plays, full silent / error | Client `canStream` false OR server 403 |
| 401 on stream | Session cookie missing (mobile Safari) |
| 403 entitled in UI but denied | Account state stale vs server DB |
| 404 | Missing `storage_path` / `media_assets` |
