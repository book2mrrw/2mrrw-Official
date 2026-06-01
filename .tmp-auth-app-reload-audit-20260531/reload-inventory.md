# Parts 3 & 7 — Root Remount Detection & Reload Inventory

Fresh grep workspace `src/` + repo root, 2026-05-31.

---

## Part 3 — Navigation / reload triggers

### `window.location.*` (src)

| File | Line(s) | Pattern | Fires during scroll / modal / playback / account sync? |
|------|---------|---------|--------------------------------------------------------|
| `src/context/AuthContext.js` | 329 | `window.location.href = redirect` | Only `enterGuest` + `postAuthRedirect` in sessionStorage — **user flow** |
| `src/app/page.js` | 1460–1463 | `search`, `history.replaceState` | URL cleanup — **no reload** |
| `src/app/page.js` | 1560 | `location.assign(COLLECTORS_CARDS_ROUTE)` | Button navigation |
| `src/app/page.js` | 1597–1657 | `URL`, `setPostAuthRedirect` | Deep-link / auth redirect prep — not scroll |
| `src/app/page.js` | 1952, 2163 | `location.href` subscribe / collectors | **User click** |
| `src/app/subscribe/page.js` | 83, 132, 334 | search / href / Stripe return_url | Subscribe route only |
| `src/lib/playback/stream-client.js` | 59, 74, 88, 103 | `location.origin` | URL building only |
| `src/context/AudioContext.js` | 108, 2358, 2398, 3231 | `new URL(..., location.href)` | Resolution only |
| `src/lib/media-session-artwork.js` | 44–66 | `location.origin` | Artwork URLs |
| `src/lib/control-system/client.js` | 41–43 | `location.origin` | API base |
| `src/lib/deep-links.js` | 23 | `location.origin` | Link builder |

### `router.push` / `replace` / `refresh` (src, excluding junk HTML)

| File | API | Home / playback context? |
|------|-----|--------------------------|
| `src/app/verify-otp/page.js` | `replace`, `push`, **`refresh`** L124 | Post-OTP only |
| `src/app/login/page.js` | `replace`, `push` | Auth routes |
| `src/app/join/page.js` | `push` | Join flow |
| `src/app/success/page.js` | `push` | Post-checkout |
| `src/app/gift/[token]/page.js` | `push` | Gift flow |
| `src/app/collector/activate/page.js` | `replace` | Activation |
| `src/components/music/DeepLinkRedirect.js` | `replace` | Deep link entry |

**Home `page.js`:** no `router.push` / `replace` / `refresh` in scroll, modal, or entitlement sync paths.

### `location.reload()`

| Scope | Count |
|-------|-------|
| `src/**` | **0** |
| Full repo app code | **0** (only mentioned in prior audit markdown) |

---

## Can these fire during scroll, modal close, playback, account sync?

| Activity | Full document reload? | Soft `router.refresh`? | Hard `window.location` nav? |
|----------|----------------------|------------------------|----------------------------|
| Scroll home (`mainScrollRef`) | No | No | No |
| Close release modal | No | No | No |
| Playback running | No | No | No |
| `refreshAccountState` / library | No | No | No |
| Entitlement poll on `/success` or `/subscribe` | No | No | No (unless user leaves route) |
| OTP verify complete | No | **Yes** (that route only) | `router.push` to next |

---

## Part 7 — Full reload / refresh inventory (ranked)

**Symptom:** "Site visibly reloads while music playing"

| Rank | Mechanism | Likelihood explains *visible reload* | Likelihood explains *playback stop* | Notes |
|------|-----------|--------------------------------------|-------------------------------------|-------|
| 1 | **React re-render** — `page.js` + entitlement prop churn | **High** | Low (unless pause hook) | Not a browser reload; feels like refresh (parallax DOM L776–800, catalog repaint) |
| 2 | **`useEntitlementAccountState` EMPTY → full** when `loading` clears | **High** | Low | Lock/CTA/admin catalog flip |
| 3 | **`liveCountdown` 1s `setInterval`** | **Medium** | None | Full `Page()` commit every second L1078–1092 |
| 4 | **iOS / deploy / tab discard** | **Medium** (external) | Medium | No in-repo loop |
| 5 | **`router.refresh()`** | **Very low** on home | Very low | Single site: `verify-otp/page.js` L124 |
| 6 | **`location.reload()`** | **None** | **None** | Not present |
| 7 | **Service worker** | **Very low** | Very low | No fetch handler, no `controllerchange` reload (`public/sw.js`) |
| 8 | **`window.location.href` on home** | **Low** | **High if clicked** | Subscribe / collectors buttons only |

### `revalidatePath` / server cache

- Used in API routes (e.g. `src/app/api/media/visual/route.js` Cache-Control) — not invoked from client home scroll.
- `src/lib/control-system/client.js` L82: `next: { revalidate: 30 }` server-side fetch option — not client reload.

### Service worker (`public/sw.js` + `layout.js` L37–40)

- Registers on `load`; `install`/`activate` only; `KEEP_ALIVE` message ACK.
- **No** `fetch` handler, **no** `skipWaiting` + `clients.claim` + reload pattern.
- `AudioContext.js` L746–748 posts `KEEP_ALIVE` to controller — does not reload page.

### Account sync / entitlements

- `refreshAccountState` — fetch + React state; **no** navigation API.
- `notifyEntitlementsUpdated` — `CustomEvent` only (`state-churn-log.js` L64–82); dispatchers: `page.js` checkout L1453, `success/page.js` L129 — **not** on cold home load or scroll.

---

## Grep commands used (reproducible)

```bash
rg 'window\.location\.|location\.reload|router\.(refresh|push|replace)' src/
rg 'location\.reload|\.reload\(' .
rg 'revalidatePath|router\.refresh' .
rg 'serviceWorker|navigator\.serviceWorker' src public
```
