# Protection Analysis — Preview Path vs Entitlements

**Files reviewed:** `src/app/api/media/preview/route.js`, `src/lib/music-access.js`, `src/lib/playback/resolve-playback-key.js`, `src/app/api/library/stream/route.js` (referenced)

---

## Preview API: no protection layer

`/api/media/preview` **does not**:

- Read cookies or session
- Call `resolveTrackAccess` or `music-access.js`
- Check Supabase entitlements
- Verify ownership, subscription, collector, or Vault
- Emit signed URLs
- Log stream events
- Rate-limit by user

It **only**:

1. Normalizes folder/legacy query params
2. Resolves R2 object key (fast path or list)
3. Returns **302** to **public** CDN URL (`getPublicR2Url`)

**Implication:** Eliminating the redirect **does not remove a security gate** — it removes a latency gate.

---

## Where protection actually lives

### Client UI gating (`music-access.js`)

| Function | Role |
|----------|------|
| `resolveTrackAccess` | Computes `owned`, `subscription`, `collector`, `previewOnly`, `canStream` |
| `resolveContentAccess` | Store vs library mode, `canPreview`, badges, cart visibility |
| `resolvePlaybackSrc` | **Entitled** → `/api/library/stream`; **Guest** → `catalogPreviewAudioUrl` |
| `canRequestLibraryStream` | Requires `access.canStream` + aligned `userId` / `accountState.user.id` |

Entitlement sources (server truth):

- `permanentOwnedSlugsFromState`, library purchase/gift rows
- `membershipHasPremiumAccess`, `subscriberActive`, `permissions.subscriber`
- `collectorCard`, `collectorOwnerships`, collector library rows
- Admin override via `isAdminAccount`

### Server stream gating (`/api/library/stream`)

- Session cookie required
- Server re-validates entitlements against Supabase
- Signed URL or same-origin redirect to protected R2
- Concurrent stream limits, analytics insert

### Playback enforcement (`AudioContext.js`)

- `PREVIEW_HARD_CAP_SEC` — 30s preview limit for `previewOnly` tracks
- Volume ducking near cap
- `preview:ended` event dispatch
- Entitled stream fallback on 401/403 → preview src

---

## Tier behavior matrix

| User tier | UI mode | Primary `audio.src` | Preview API used? |
|-----------|---------|---------------------|-------------------|
| Guest | store / discovery | Preview (API→CDN) | ✅ |
| Guest w/ expired sub | store, badge | Preview | ✅ |
| Subscriber (active) | library | library/stream | ❌ primary |
| Owner (purchase) | library | library/stream | ❌ primary |
| Collector card | library | library/stream | ❌ primary |
| Admin | library | library/stream | ❌ primary |

**Fallback:** Entitled user with stream 401/403 → `getTrackPreviewSrc` → preview API (same public bytes as guest).

---

## Ownership & collector

- **Ownership** unlocks stream API, not preview API
- **Collector** grants full-catalog stream via `collectorCardOwner` / ownership records
- Preview remains available to non-owners by design (discovery)
- Direct CDN bypass **does not** grant ownership or stream access

---

## Storefront vs library

| Context | Access resolver | Audio path |
|---------|-----------------|------------|
| Storefront card play (guest) | `resolveContentAccess` → `canPreview: true` | Preview |
| Storefront card play (entitled) | `canStream: true` | Stream |
| My Music tab | `canStream` required to play | Stream only |
| Modal "30 sec preview" label | `ImmersivePreviewModal` `access="preview"` | Parent triggers preview path |

---

## Tracking & anti-abuse

| Mechanism | Preview API | Direct CDN |
|-----------|-------------|------------|
| Stream session tracking | ❌ | ❌ |
| Playback events (CS) | ❌ (client fires on play) | Same (client) |
| Entitlement consumption | ❌ | ❌ |
| IP/rate limit on preview | ❌ | ❌ |

Preview discovery is **intentionally frictionless**. Bypass does not change tracking posture.

---

## What must NOT be bypassed

| Asset class | Prefix / route | Bypass safe? |
|-------------|----------------|--------------|
| Public previews | `previews/` | ✅ |
| Public artwork/video | `artwork/`, `videos/` | ✅ (separate concern) |
| Full masters | `protected-media/`, `digital-assets/` audio | ❌ **Never** embed in client |
| Vault content | `/api/vault/media` | ❌ |
| Library stream | `/api/library/stream` | ❌ Must remain gated |

**Guardrail for implementation:** Direct CDN embed must use `isConcreteMediaKey` + prefix allowlist (`previews/` only for audio preview bypass).

---

## Bypass safety conclusion

| Question | Answer |
|----------|--------|
| Does bypass expose full tracks? | **No** — only public preview keys |
| Does bypass skip entitlement checks that exist today? | **No** — those checks were never on preview API |
| Does bypass affect collector/subscriber stream? | **No** — separate path |
| Does bypass weaken 30s cap? | **No** — enforced in AudioContext on `previewOnly` metadata |

**Safe to bypass for public preview keys.** Not safe to bypass library stream or master resolution.
