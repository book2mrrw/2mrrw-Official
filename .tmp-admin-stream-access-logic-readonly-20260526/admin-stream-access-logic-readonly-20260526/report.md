# Admin stream access logic (read-only)

This report contains the exact conditional logic extracted from:
- `src/app/api/library/stream/route.js`
- `src/app/api/account/state/route.js`
- `src/lib/music-access.js`

## 1) `src/app/api/library/stream/route.js`

### Streaming entitlement gate (403 vs proceed)

```js
async function validateStreamEntitlement(user, slug) {
  const canStream = await userCanStreamProduct(user.id, slug, user);
  if (!canStream) {
    return NextResponse.json({ error: "Not entitled to stream this item" }, { status: 403 });
  }
  return null;
}
```

```js
  const denied = await validateStreamEntitlement(user, slug);
  if (denied) return denied;
```

### 401 condition (Unauthorized) in `GET`

```js
  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

### 401 condition (Unauthorized) in `DELETE`

```js
  const user = await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

### Other conditional exits relevant to “can stream”

```js
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
```

```js
  if (!productId) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
```

```js
    const active = await findActiveStreamSession(admin, user.id, productId);
    if (active?.session_id) {
      return NextResponse.json(
        {
          error: "Already streaming on another device",
          code: "CONCURRENT_STREAM",
          sessionId: active.session_id,
        },
        { status: 409 }
      );
    }
```

```js
  if (!resolved?.key) {
    logStreamR2Env("no_playback_key");
    return NextResponse.json({ error: "No downloadable asset for this item" }, { status: 404 });
  }
```

### Admin role specifically checked?

No explicit “user is admin” conditional exists in this file; it uses `createAdminClient()` for server-side operations, and the stream authorization decision is driven by:
`await userCanStreamProduct(user.id, slug, user)`

## 2) `src/app/api/account/state/route.js`

### Admin flag in `permissionsFor(...)`

```js
function permissionsFor({ membership, hasCollectorAccess, hasVaultPass, isGuest = true, user = null, userEntitlements = null }) {
  ...
  return {
    ...
    admin: isAdminUser(user),
    ...
    entitlements: userEntitlements
      ? {
          vault_access: Boolean(userEntitlements.vault_access),
          subscriber: Boolean(userEntitlements.subscriber),
          collector_card: Boolean(userEntitlements.collector_card),
        }
      : null,
  };
}
```

### Admin “full library” expansion logic

```js
    const adminFullLibrary = isAdminUser(user);
    if (adminFullLibrary || membershipHasPremiumAccess(membership) || hasCollectorAccess) {
      (productsResult.data || [])
        .filter(isDigitalProduct)
        .forEach((product) => {
          if (!bySlug.has(product.slug)) {
            bySlug.set(product.slug, {
              ...
              source: adminFullLibrary
                ? "admin"
                : membershipHasPremiumAccess(membership)
                  ? "membership"
                  : "collector_access",
              gifted: false,
              membershipAccess: !adminFullLibrary && membershipHasPremiumAccess(membership),
              collectorAccess: hasCollectorAccess,
              purchasedAt: null,
            });
          }
        });
    }
```

### Admin-relevant fields in the final response payload (`body`)

```js
    const body = {
      ...
      permissions: permissionsFor({
        membership,
        hasCollectorAccess,
        hasVaultPass,
        isGuest: Boolean(user.isGuest),
        user,
        userEntitlements,
      }),
      ...
      userEntitlements: {
        vault_access: Boolean(userEntitlements?.vault_access),
        subscriber: Boolean(userEntitlements?.subscriber),
        collector_card: Boolean(userEntitlements?.collector_card),
        collector_card_id: userEntitlements?.collector_card_id || null,
      },
      ...
    };
```

### Does it set an admin flag (not just subscriber/purchase flags)?

Yes. The returned `permissions` object includes:
`admin: isAdminUser(user)`

## 3) `src/lib/music-access.js`

### `resolveTrackAccess(...)` admin fast-path

```js
export function isAdminAccount(accountState = {}) {
  if (Boolean(accountState?.permissions?.admin)) return true;
  if (Boolean(accountState?.isAdmin)) return true;
  const user = accountState?.user;
  if (user && isAdminUser(user)) return true;
  return false;
}

export function adminTrackAccess() {
  return {
    owned: true,
    subscription: true,
    collector: true,
    collectorCardOwner: true,
    previewOnly: false,
    canStream: true,
    canAddToLibrary: true,
    canAddToPlaylist: true,
    canShare: true,
    subscriptionLocked: false,
    badge: null,
    admin: true,
  };
}

export function resolveTrackAccess(track, accountState = {}) {
  ...
  if (isAdminAccount(accountState)) {
    return adminTrackAccess();
  }
  ...
}
```

### Exact returned fields for an admin user (what `resolveTrackAccess` returns)

When `isAdminAccount(accountState)` is true, `resolveTrackAccess` returns:
```js
{
  owned: true,
  subscription: true,
  collector: true,
  collectorCardOwner: true,
  previewOnly: false,
  canStream: true,
  canAddToLibrary: true,
  canAddToPlaylist: true,
  canShare: true,
  subscriptionLocked: false,
  badge: null,
  admin: true,
}
```

### Does `canStream` ever become true for admin role?

Yes, via the admin fast-path return above (`canStream: true`), and also via the following conditional:

```js
  if (trackAccess.admin) {
    return {
      ...trackAccess,
      tier: "admin",
      mode: "library",
      canPreview: false,
      canStream: true,
      canAddToLibrary: true,
      canAddToPlaylist: true,
      canShare: true,
      canOffline: true,
      showPrice: false,
      showCart: false,
      badges: [],
    };
  }
```

