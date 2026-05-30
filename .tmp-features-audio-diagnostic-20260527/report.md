# Full Entitlement & Audio Regression Audit (Read-Only)

**Repo:** `/Users/recharge/artist-platform`  
**Audit date:** 2026-05-27  
**Context commits:** `97f2439` (feature in `isDigitalProduct` + AudioContext 403 fallback), `51af6ff` (unified catalog normalization)  
**Mode:** READ ONLY — no code changes, no commits

---

## Pre-flight reference answers

### Admin detection

| Layer | Mechanism | File:Line |
|-------|-----------|-----------|
| Server stream | `isAdminUser(user)` in `userCanStreamProduct` | `src/lib/commerce/entitlements.js:96-106` |
| Server account state | `isAdminUser(user)` → `permissions.admin` | `src/app/api/account/state/route.js:46,192` |
| Client access | `accountState.permissions.admin === true` (early return) | `src/lib/music-access.js:104-110` |
| Client access | `isAdminAccount(accountState)` → `adminTrackAccess()` | `src/lib/music-access.js:65-70,129-130` |
| Identity constants | `ADMIN_USER_ID`, `ADMIN_EMAIL`, `user.role === "admin"` | `src/lib/auth/constants.js:1-9` |

### Subscriber detection

| Layer | Mechanism | File:Line |
|-------|-----------|-----------|
| Server stream (membership path) | `membershipHasPremiumAccess(membership)` | `src/lib/commerce/entitlements.js:110-114,255-258` |
| Client `canStream` | `isSubscriber` = `subscriptionActive && subscriberActive && permissions.subscriber` | `src/lib/music-access.js:139-141,175-179` |
| Account state | `subscriberActive` + `permissions.subscriber` | `src/app/api/account/state/route.js:204-205,35` |

### Collector card ownership

| Layer | Mechanism | File:Line |
|-------|-----------|-----------|
| Server stream | `getCollectorAccessState` → `collector.hasCollectorAccess` | `src/lib/commerce/entitlements.js:112-114,291-319` |
| Client global unlock | `isCollectorCardOwner(accountState)` / `collectorCardOwner` in `canStreamFull` | `src/lib/music-access.js:57-61,144-147,179` |
| Vault (not audio) | `permissions.vaultPass`, `hasVaultAccess` | `src/app/api/account/state/route.js:208-211`, `src/lib/entitlements.js:37-38` |

### Individual purchase

| Layer | Mechanism | File:Line |
|-------|-----------|-----------|
| Server stream | `userOwnsProduct(userId, productSlug)` | `src/lib/commerce/entitlements.js:66-90,108` |
| Client | `ownedSlugs` / `purchased.has(slug)` | `src/lib/music-access.js:133-153,179` |

### `isDigitalProduct` (full function)

```244:253:src/lib/commerce/entitlements.js
export function isDigitalProduct(product) {
  const type = product?.product_type || product?.type;
  return (
    type === "digital" ||
    type === "audio" ||
    type === "single" ||
    type === "album" ||
    type === "feature"
  );
}
```

### `userCanStreamProduct` (full function)

```94:123:src/lib/commerce/entitlements.js
export async function userCanStreamProduct(userId, productSlug, user = null) {
  if (!userId || !productSlug) return false;
  if (user && isAdminUser(user)) return true;
  const admin = createAdminClient();
  if (!user) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("id", userId)
      .maybeSingle();
    if (profile && isAdminUser({ id: profile.id, email: profile.email, role: profile.role })) {
      return true;
    }
  }
  if (await userOwnsProduct(userId, productSlug)) return true;

  const membership = await getActiveMembership(userId);
  const ownedSlugs = await getOwnedSlugs(userId);
  const collector = await getCollectorAccessState(admin, userId, [...ownedSlugs]);
  const entitled =
    membershipHasPremiumAccess(membership) || collector.hasCollectorAccess;
  if (!entitled) return false;

  const { data: product } = await admin
    .from("products")
    .select("id, product_type")
    .eq("slug", productSlug)
    .maybeSingle();
  return Boolean(product && isDigitalProduct(product));
}
```

### `resolveTrackAccess` (full function)

```103:201:src/lib/music-access.js
export function resolveTrackAccess(track, accountState = {}) {
  // ... see source file lines 103-201
}
```

### `resolvePlaybackSrc` (full function)

```214:228:src/lib/music-access.js
export function resolvePlaybackSrc(track, access, { userId } = {}) {
  if (!track) return "";
  if (userId && track.slug && access?.canStream) {
    const offline = getOfflinePlaybackUrl(userId, track.slug);
    if (offline) return offline;
  }
  if (access?.canStream && track.slug) {
    return libraryStreamRedirectSrc(track.slug);
  }
  const previewPath = track.preview || track.preview_path || track.previewPath;
  if (previewPath) {
    return catalogPreviewAudioUrl(previewPath);
  }
  return track.preview || track.src || track.audio || "";
}
```

---

## Section 1 — Regression

### `git log --oneline -10` (full)

```
4100ee3 docs(checkpoint): frontend-checkpoint-20260527-2351 build frame of mind
43c2fad docs(foundation): add platform build frame of mind for AI sessions
97f2439 fix(audio): features section playback root cause
51af6ff fix(audio): restore Features and album playback via unified track normalization
5b4cdd3 fix(modal): stabilize singles features albums modal lifecycle and account tab
04dc78d fix(audio): correct F2 F4 mobile gesture and resume per prompt
627f3e7 fix(audio): mobile audio per production prompt (F1–F5)
db88530 fix(modal): permanent mobile modal and account tab crash fixes
0b26e4c feat(audio): position memory — resume same song, restart on track switch
04b1c59 fix(audio): iOS mobile Safari gesture unlock at start of playTrack
```

### `git diff HEAD~1..HEAD` on audio paths

**Empty for all five paths.** Latest commit (`4100ee3`) is documentation only; it did not touch entitlement or audio code.

### What `97f2439` changed

1. **`isDigitalProduct`** — added `type === "feature"` (`src/lib/commerce/entitlements.js:251`).
2. **`AudioContext`** — stream error fallback expanded from **401-only** to **401 or 403** when `metadata.access.canStream` is true; preview resolution now uses `getTrackPreviewSrc(track)` first (`src/context/AudioContext.js:986-1000,1260-1273`).
3. **`music-playback.js`** — minor diff vs parent (normalization already landed in `51af6ff`).

### What `51af6ff` changed (normalization)

- Added `normalizeCatalogItemForPlayback`, `buildCatalogPlaybackLookup`, `resolveCatalogPlaybackItem`, `resolveAlbumTrackPlaybackItem` (`src/lib/music-playback.js:37-137`).
- `toPlaybackTrack` now normalizes via `withR2CatalogMedia` and sets `metadata.previewSrc` (`src/lib/music-playback.js:139-183`).
- `page.js` wires `catalogPlaybackLookup` for singles/features/albums (`src/app/page.js:780-788,1105-1181`).

### Regression hypothesis for “singles worked, now broken”

| Change | Affects singles? | Verdict |
|--------|------------------|---------|
| `"feature"` in `isDigitalProduct` | No — singles still match `single` | Not a singles regression |
| 403 → preview fallback when `canStream: true` | **Yes** — if stream returns 403 while client believes user is entitled, user hears **preview** instead of error/retry | **HIGH — likely perceived regression for entitled users** |
| Unified normalization | Possible if API `browseSingles` items lack `preview`/`slug` alignment | MEDIUM — verify API catalog shape |

**Primary flagged regression (file:line):** `src/context/AudioContext.js:986-988` and `1260-1261` — treating **403** like **401** and downgrading entitled playback to preview when `track.metadata.access.canStream === true`.

**Note:** Admin server path bypasses `isDigitalProduct` (`entitlements.js:96-97`), so admin should not get 403 from entitlement gate; admin singles failure is more likely **404** (missing R2 key) or **client preview downgrade** on mistaken 403, not missing `feature` type.

---

## Section 2 — `product_type` coverage

### Unique `product_type` values in codebase

From static catalog and code references:

| Value | Example source |
|-------|----------------|
| `single` | `src/lib/commerce/catalog.js:3-6`, `page.js` singles |
| `feature` | `catalog.js:7-8`, `page.js:170-171` |
| `album` | `catalog.js:9-11`, `page.js` albums |
| `ep` | `src/lib/commerce/resolve-storefront-product.js:24,36` (mapping only) |
| `digital` | `music-access.js:251` partition |
| `audio` | `isDigitalProduct`, partition |
| `vinyl` | `catalog.js:12-14` |
| `vault` | collector cards |
| `bundle` | exclusive bundle |
| `merch` | hoodie/shirt/hat |
| `album_track` | `music-playback.js:121` (client-only type, not DB) |

### `isDigitalProduct` coverage table

| `product_type` | In `isDigitalProduct`? |
|----------------|------------------------|
| `digital` | Yes |
| `audio` | Yes |
| `single` | Yes |
| `album` | Yes |
| `feature` | Yes (added `97f2439`) |
| `ep` | **No** |
| `vinyl` | No (physical) |
| `vault` | No |
| `bundle` | No |
| `merch` | No |
| `album_track` | **No** (not a DB type) |

**Missing types that can gate subscribers/collectors on server:** `ep` — if any live product uses `product_type: "ep"`, `userCanStreamProduct` returns false at `entitlements.js:122` even with active membership.

---

## Section 3 — Entitlement resolution per tier per section

**Test slugs:** single `hour-glass`, feature `i-dont-believe-you`, album product `tbh` (modal track example `Glass Full` → derived slug `glass-full`).

### Tier 1 — Admin / Owner

| Section | `resolveTrackAccess` | `resolvePlaybackSrc` | User hears (expected: full) |
|---------|----------------------|----------------------|-------------------------------|
| Singles (`hour-glass`) | `canStream: true`, `previewOnly: false` via `permissions.admin` or `adminTrackAccess` | `/api/library/stream?slug=hour-glass&redirect=1` | Full stream if R2 key exists |
| Features (`i-dont-believe-you`) | Same | Same pattern with feature slug | Full stream |
| Albums (`tbh` product) | Same for album slug | Stream via `tbh` | Full stream |
| Album track (`glass-full` derived) | **Still `canStream: true`** (admin) | Stream URL uses **wrong slug** `glass-full` | **404 / error / erroneous preview fallback** — **BUG** |

Admin bypasses `isDigitalProduct` on server (`entitlements.js:96-97`). No `product_type` gate between admin and `canStream: true` on client.

### Tier 2 — Subscriber

| Section | Client `canStream` | Server `userCanStreamProduct` | Notes |
|---------|-------------------|------------------------------|-------|
| Singles | `true` if `subscriberActive && permissions.subscriber` | `true` if membership + `isDigitalProduct` | Requires **both** flags (`music-access.js:175-178`) |
| Features | Same | `true` after `97f2439` (`feature` in digital set) | Was broken before `97f2439` for server |
| Album (`tbh`) | Same | `true` (`album` in digital set) | OK at album level |
| Album track (`glass-full`) | `true` | **`false`** — no product row | Client still requests stream for derived slug — **mismatch** |

### Tier 3 — Collector card owner

| Section | Client | Server | Vault |
|---------|--------|--------|-------|
| All digital sections | `canStream: true` via `collectorCardOwner` (global) | `true` when `hasCollectorAccess` + `isDigitalProduct` | Vault via `permissions.vaultPass` / `hasVaultAccess` in account state — **not** in `music-access.js` |
| Album tracks (derived slugs) | `true` | **false** (no product) | N/A |

Collector check is **global** for streaming (`music-access.js:179`), not per-track — **correct**.

### Tier 4 — Individual purchaser

| Section | Behavior |
|---------|----------|
| Purchased slug | `owned: true`, `canStream: true` (`music-access.js:149-153,179`) |
| Unpurchased slug | `previewOnly: true`, preview URL if `preview` path on item |
| Post-purchase | `success/page.js:111` and `page.js:1289` dispatch `entitlements:updated`; `AudioContext` `upgradeToFullStream` on preview (`AudioContext.js:1677-1686`) — **no full page reload required** |

### Tier 5 — Logged in, no entitlement

| Section | `resolveTrackAccess` | `resolvePlaybackSrc` | User hears |
|---------|----------------------|----------------------|------------|
| Singles | `previewOnly: true`, `canStream: false` | `catalogPreviewAudioUrl(preview)` | Preview (30s cap in `AudioContext.js:780-802`) |
| Features | Same — previews in `page.js:170-171` | R2 preview URLs via `withR2CatalogMedia` | Preview |
| Albums | Same at album slug; **track rows often lack preview** | `""` if no preview on album/track | **Silence / “no playback src”** — **HIGH** |

**Dead / legacy path:** Stream route accepts `getGuestUser()` (`stream/route.js:109`). Prompt treats unauthenticated access as out of scope; guest session still exists in code (`src/lib/guest-session.js`).

---

## Section 4 — Stream API gate per tier per section

Flow (`src/app/api/library/stream/route.js`):

1. `GET` — require `slug` (400 if missing) — lines 103-107  
2. `getFanSessionUser() ?? getGuestUser()` — 401 if null — lines 109-112  
3. `validateStreamEntitlement` → `userCanStreamProduct` — **403** if false — lines 40-45, 49-50  
4. `resolveProductIdBySlug` — **404** if no product — lines 53-56  
5. `resolvePlaybackKey` — **404** if no R2 key — lines 67-71  
6. Success — **302** if `redirect=1`, else JSON with signed URL — lines 81-99  

### Status codes by tier (same for all sections **when slug exists in `products`**)

| Tier | Typical status |
|------|----------------|
| Admin | 302/200 (entitlement always passes) |
| Subscriber / Collector | 302/200 if `isDigitalProduct(product)` |
| Purchaser (owned slug) | 302/200 |
| No entitlement | **403** |
| No session | **401** |
| Unknown slug (e.g. `glass-full`) | **404** after entitlement passes for admin |

### Section-specific server difference

| Section | Slug used | `isDigitalProduct` on server |
|---------|-----------|------------------------------|
| Singles | Real product slug | `single` → true |
| Features | `i-dont-believe-you`, `2-heavy` | `feature` → true **after 97f2439**; false before |
| Album modal track | Often **derived** title slug, not `tbh` | Product lookup fails → 404 (admin still passes 403 gate) |

**Incorrect 403 for entitled feature (pre-97f2439):** Subscriber/collector with `product_type: "feature"` failed `isDigitalProduct` → 403 at line 43.

---

## Section 5 — AudioContext error handling

| Question | Answer | File:Line |
|----------|--------|-----------|
| Non-2xx stream fetch | `fetchLibraryStream` throws `ACCESS_DENIED` with `status` 401/403 (`stream-client.js:70-90`); `playTrack` / `onError` handle via `applyStreamResolveError` or retry | `stream-client.js:70-90`, `AudioContext.js:926-1049`, `1259-1334` |
| 401 → preview fallback? | **Yes**, when `canStream` true and preview available | `AudioContext.js:986-1020`, `1260-1293` |
| 403 → preview fallback? | **Yes** (added `97f2439`) — same condition | `AudioContext.js:986-988`, `1260-1261` |
| `previewSrc` on features? | **Yes** — `toPlaybackTrack` sets `metadata.previewSrc` when `previewPath` exists; features have `preview` in `page.js:170-171` | `music-playback.js:157-178`, `page.js:170-171` |
| `previewSrc` on albums? | **Album product:** only if preview on album object (static albums have **no** preview). **Tracks:** inherit album preview in resolver, but static data has none | `music-playback.js:114`, `page.js:227-229` |
| Both stream and preview fail | `patchState` error `"Stream unavailable — tap to retry"` or `"Audio source unavailable."` / access denied | `AudioContext.js:1044-1048`, `1222-1235`, `1023-1033` |

### `getTrackPreviewSrc` (preview resolution)

```145:154:src/context/AudioContext.js
function getTrackPreviewSrc(track) {
  const previewPath =
    track?.preview ||
    track?.preview_path ||
    track?.previewPath ||
    track?.metadata?.previewPath;
  if (previewPath) return catalogPreviewAudioUrl(previewPath);
  if (track?.src && !isLibraryStreamSrc(track.src)) return track.src;
  return null;
}
```

### Entitled-user preview path in `playTrack`

When `usesLibraryStream && entitledFullStream && redirectFastPath`, audio loads stream URL directly (`AudioContext.js:1248-1256`). Preview used when `previewSrc && !entitledFullStream` (`1250-1251`).

---

## Section 6 — Summary table

| Section | Tier | Expected | Actual (code trace) | Status | File | Line |
|---------|------|----------|---------------------|--------|------|------|
| Singles | Admin | Full stream | Client full; server bypass; 302 if asset exists | OK if R2 key exists | `entitlements.js` | 96-97 |
| Singles | Subscriber | Full stream | Needs `subscriberActive` + `permissions.subscriber` | OK if flags set | `music-access.js` | 175-179 |
| Singles | Collector | Full stream | Global `collectorCardOwner` | OK | `music-access.js` | 179 |
| Singles | Purchaser | Full for owned slug only | `owned` / `userOwnsProduct` | OK | `music-access.js` | 149-153 |
| Singles | No entitlement | Preview | Preview URL + 30s cap | OK | `AudioContext.js` | 780-802 |
| Features | Admin | Full stream | Same as singles | OK | `entitlements.js` | 96-97 |
| Features | Subscriber | Full stream | Server OK post-97f2439 | OK (fixed) | `entitlements.js` | 251 |
| Features | Collector | Full stream | Same | OK | `music-access.js` | 179 |
| Features | Purchaser | Full if purchased | Per-slug owned | OK | `entitlements.js` | 108 |
| Features | No entitlement | Preview | Previews defined | OK | `page.js` | 170-171 |
| Albums/EPs | Admin | Full | Album slug OK; **track index uses derived slugs** | **FAIL** on track play | `music-playback.js` | 100-122 |
| Albums/EPs | Subscriber | Full | Album slug OK on card; tracks 404 | **PARTIAL** | `stream/route.js` | 53-56 |
| Albums/EPs | Collector | Full | Same as subscriber | **PARTIAL** | `music-playback.js` | 198-208 |
| Albums/EPs | Purchaser | Full if album owned | `albumSlug` in owned check | OK if purchased | `music-access.js` | 150-153 |
| Albums/EPs | No entitlement | Preview | Often **no preview path** on album/tracks | **FAIL** silent | `music-playback.js` | 207-208 |

---

## Section 7 — Confirmed working (do not break)

1. **Admin server bypass** — `userCanStreamProduct` returns true before product type check (`entitlements.js:96-106`).
2. **Admin library injection** — account state merges all `isDigitalProduct` SKUs into library (`account/state/route.js:156-178`).
3. **Feature `product_type` in `isDigitalProduct`** — fixes subscriber/collector 403 on features (`97f2439`, `entitlements.js:251`).
4. **Unified R2 preview resolution** — `withR2CatalogMedia` + `catalogPreviewAudioUrl` for storefront paths (`catalogMedia.js:9-18`, `media-urls.js:39-46`).
5. **Catalog playback lookup** — merges inline singles/features for consistent slugs/previews (`page.js:780-788`, `music-playback.js:54-98`).
6. **Redirect fast path** — `libraryStreamRedirectSrc` + `redirect=1` avoids JSON prefetch (`music-access.js:204-207`, `stream/route.js:81-91`).
7. **Post-purchase upgrade** — `entitlements:updated` → `upgradeToFullStream` (`AudioContext.js:1677-1686`).
8. **Collector global stream** — `collectorCardOwner` in `canStreamFull`, not per-track (`music-access.js:179`).
9. **Known feature slugs** — `i-dont-believe-you`, `2-heavy` with preview paths in catalog (`catalog.js:7-8`).

---

## Appendix A — `grep product_type` (representative; 30+ hits)

Key paths: `src/lib/commerce/catalog.js`, `src/app/api/account/state/route.js`, `src/lib/commerce/entitlements.js`, `src/lib/music-access.js`, `src/lib/commerce/resolve-storefront-product.js`, `src/app/page.js` (via `type` on items).

## Appendix B — Broken feature slug references

```
src/lib/commerce/catalog.js:7-8  — i-dont-believe-you, 2-heavy
src/app/page.js:170-171          — same slugs + preview wav paths
```

## Appendix C — R2 preview paths

Features and singles use `/audio/previews/...` remapped to R2 `previews/` (`media-urls.js:42-44`). `withR2CatalogMedia` applies `catalogPreviewAudioUrl` to `item.preview` (`catalogMedia.js:14`).

---

## Recommended fix directions (documentation only — not applied)

1. Revert or narrow **403 → preview fallback** to cases where preview downgrade is intentional; keep 403 as hard error for `canStream: true` (`AudioContext.js:986-988`).
2. Album modal: stream by **album product slug** (`tbh`) or map track titles → real product/track IDs; do not use `titleToCatalogSlug` alone for entitlement stream (`music-playback.js:100-122`).
3. Add `ep` to `isDigitalProduct` if DB uses it (`entitlements.js:244-252`).
4. Add album-level preview paths or skip per-track queue when tracks lack `src` (`page.js` albums, `music-playback.js:198-208`).
