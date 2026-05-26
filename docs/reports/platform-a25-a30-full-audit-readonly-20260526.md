# Platform Audit A25–A30 (Read-Only)

**Date:** 2026-05-26  
**Primary repo:** `/Users/recharge/artist-platform`  
**Control System:** `/Users/recharge/2MRRW-Control-System` (confirmed present)

---

## Executive Summary

| Section | Topic | Overall |
|---------|--------|---------|
| A25 | Gifting system | **PARTIAL** — admin single-recipient + redeemable links; no bulk/broadcast |
| A26 | Community + player | **PARTIAL** — tabs in `page.js`; APIs exist but unused; no track-linked comments |
| A27 | Release scheduler / pre-release | **PARTIAL** — Control System strong; storefront display-only upcoming |
| A28 | Collector card visual | **PARTIAL** — animated grid + modal; no player skin / detail page |
| A29 | Fan profile / listening history | **PARTIAL** — account tab + rails; no dedicated profile route |
| A30 | Vault visual environment | **PARTIAL** — unlocked room on Inner Circle; vault tab placeholder |

---

## A25 — Gifting System Current State

### 1. Artist Platform — `/src/app/api/` gifting routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/gifts/send` | POST | Admin-only: send one gift to one email (`sendStorefrontGift`). Lines 7–24 gate `isAdminUser`. |
| `/api/gifts/sent` | GET | Admin-only list of sent `gifts` rows (max 100). |
| `/api/gifts/claim/[token]` | POST | Recipient claims `gifts` row by token; email match; `grantLibraryItems`. |
| `/api/gifts/preview/[token]` | GET | Public preview of gift state before claim. |
| `/api/gifts/redeem` | POST | Redeem multi-product **`gift_links`** (admin seed links), not per-user `gifts`. |
| `/api/gifts/purchase` | POST | Guest creates pending `gift_transactions` (paid fan gifting scaffold). |
| `/api/admin/gifts` | POST | Creates **`gift_links`** + token URL (`/gift/{raw}`) via `ADMIN_SEED_SECRET`. |
| `/api/cron/expire-gifts` | GET/POST | Marks pending `gifts` expired past `expires_at`. |
| `/api/cron/gift-reminders` | GET/POST | Email reminders for unclaimed gifts. |

**Related (non-`/gifts/`):** `grantLibraryItems` in `/Users/recharge/artist-platform/src/lib/commerce/entitlements.js` (lines 125+).

### 2. Artist Platform — gifting components

| File | Role |
|------|------|
| `src/components/gifts/GiftButton.js` | UI trigger (icon/label). |
| `src/components/gifts/GiftBottomSheet.js` | Admin send form → `POST /api/gifts/send` (email, phone, message). |
| `src/components/gifts/GiftOverlayButton.js` | Overlay variant. |
| `src/components/gifts/GiftIcon.js` | Shared icon/color. |
| `src/components/gifts/GiftsSentSection.js` | Admin history UI → `/api/gifts/sent`. |
| `src/components/gifts/GiftRevealExperience.js` | Post-claim cinematic reveal. |
| `src/app/gift/[token]/page.js` | Claim page + reveal flow. |
| `src/components/preview/immersive/ModalActionButtons.js` | Gift action in immersive modal (admin-gated via `openGiftSheet`). |

**Admin gift UI inputs:** recipient email (required), phone (optional), message, release/product context. **Recipients:** single email only — no list, broadcast, or segment picker.

**Fan gifting:** `GiftBottomSheet` and catalog gift buttons call the same admin-only `/api/gifts/send`. `openGiftSheet` in `page.js` (lines 1166–1168) returns early unless `isAdmin`. Paid fan path: `POST /api/gifts/purchase` → `gift_transactions` (no full checkout UI wired in grep scope).

### 3. Control System — gift routes

| Route | Purpose |
|-------|---------|
| `src/app/api/gifts/send/route.ts` | Studio admin: `sendAdminGift` → Supabase `gifts` + Resend email. |
| `src/app/api/gifts/list/route.ts` | Admin gift list + claim feed. |
| `src/app/api/gifts/revoke/route.ts` | Revoke gift + library rollback. |
| `src/app/api/admin/gifts/route.ts` | Proxy to storefront `POST /api/admin/gifts` for **gift_links** (commerce slugs). |

**UI:** `AdminGiftsPanel.tsx`, `AdminGiftSendModal.tsx` — single recipient email/phone/message; duplicate detection; no bulk/broadcast.

**Bulk:** No gift bulk routes. `bulk` in Control System refers to **release draft** bulk actions (`/api/admin/releases/manage/bulk`), not gifting.

### 4. Supabase — gifting tables

**`gifts`** (`supabase/migrations/20260522140000_gifting_system.sql`):

- `sender_id`, `recipient_id`, `recipient_email`, `recipient_phone`
- `item_type`, `item_id`, `item_title`, `message`
- `claimed`, `claimed_at`, `gift_link_token` / hash (later migration `20260602000000_gift_token_hash.sql`)
- `expires_at`, `notified_email`, `reminder_sent`, `status` (`pending|claimed|expired|revoked`)

**`gift_links` / `gift_link_items` / `gift_redemptions`** (`003_guest_gifts_memberships.sql`): multi-redemption admin links.

**`gift_transactions`** (`010_release_commerce_extensions.sql`): paid gift purchase pending state.

**Library linkage:** `library_items.gifted_by`, `gift_id`; `purchases.gift_id`, `purchase_type`.

### 5. Query all subscribers / collector owners as recipients?

**MISSING.** No API or UI queries `memberships` or `collector_ownerships` for bulk gift recipient lists.

### 6. Fan gift notification

| Channel | Status |
|---------|--------|
| Email (Resend) | **EXISTS** — Control System `giftService.ts` lines 68–112; cron reminders in artist-platform. |
| In-app / `notification_inbox` | **MISSING** — no `gift` type in `NotificationCenterPanel.js`. |
| Claim UX | **EXISTS** — `/gift/[token]`, `GiftRevealExperience`, join/login with `?gift=` |

### A25 Feature Matrix

| Feature | Status |
|---------|--------|
| Single fan gifting (paid, fan-initiated) | **PARTIAL** — `gift_transactions` + `/api/gifts/purchase`; UI/checkout not end-to-end |
| Single admin gifting (one recipient) | **EXISTS** |
| Bulk gift → all subscribers | **MISSING** |
| Bulk gift → all collector owners | **MISSING** |
| Bulk gift → all platform users | **MISSING** |
| Gift notification to recipient | **PARTIAL** — email only |
| Gift history for admin | **EXISTS** — Control System panel + `/api/gifts/sent` + account `GiftsSentSection` |
| Gift history for fan | **MISSING** — no “gifts received” list |

---

## A26 — Community Tab Integration with Player

### Community files

- **Routes (API):** `src/app/api/community/circle/route.js`, `src/app/api/community/comments/route.js`
- **Lib:** `src/lib/community/identity.js`
- **Migrations:** `006_community_circle_system.sql`, `20260516222800_community_circle_system.sql`
- **UI:** Embedded in `src/app/page.js` tabs: `blog`, `vision`, `circle`, `innercircle`, `live` (nav group `g-community`, lines 1466, 875)

**No** `src/app/community/` route. **No** `src/components/community/` folder.

### Answers

1. **Community tab route path?** In-app tabs on `/` (`page.js`), not a separate Next route. URL path mapping: `blog|vision|circle|innercircle|live` → community ambient group (line 875).

2. **Audio continues with mini player?** **EXISTS (global).** `GlobalAudioPlayerBar` in `src/app/layout.js` (lines 37–46) wraps all pages. Community tabs do not stop `AudioProvider`. Desktop also has inline now-playing bar in `page.js` (lines 2394–2413).

3. **Comment on track from immersive modal?** **MISSING.** No comment UI in `src/components/preview/`. Community comments API allows sections `blog|vision|innercircle|live` only — not track/release `item_id` for music.

4. **Connection playing track ↔ community conversation?** **MISSING.** No shared state between `AudioContext` current track and community APIs.

5. **Real-time reactions?** **PARTIAL (backend only).** `circle_reactions` table + API in `circle/route.js`; **frontend does not call** `/api/community/*` (grep: zero fetches). Circle tab uses **localStorage** `2mrrw_circle` (lines 839–841, 1246–1250).

### A26 Matrix

| Item | Status |
|------|--------|
| Community tab / sections | **EXISTS** (static + local Circle) |
| Player persists on community tab | **EXISTS** |
| Track comments (modal or community) | **MISSING** |
| Track-linked conversation | **MISSING** |
| Live reactions (wired UI) | **MISSING** |
| Live reactions (API/schema) | **PARTIAL** |

---

## A27 — Release Scheduler and Pre-Release Gate

### Control System (primary)

| Component | Path |
|-----------|------|
| Schedule persistence | `src/server/releases/scheduledPublishService.ts` |
| Cron publish | `src/app/api/cron/scheduled-releases/route.ts` |
| Schedule API | `src/app/api/admin/releases/manage/[id]/schedule/route.ts` |
| UI | `ReleaseScheduleSection.tsx`, `releases/scheduled/page.tsx`, `releases/new/scheduler/page.tsx` |
| Migration | `src/db/migrations/0017_release_scheduling.sql` |
| Live status | `src/lib/catalog/releaseLiveStatus.ts` (`scheduled`, `scheduledInFuture`) |
| Preview snippets upload | `MediaUploadPanel.tsx` category `preview_snippets` |

**Scheduled release → storefront:** **EXISTS (auto).** Cron `runScheduledPublishJob` publishes due releases (`status=scheduled`, `scheduled_publish_at <= now`).

### Artist Platform (storefront)

| Question | Status | Evidence |
|----------|--------|----------|
| Auto vs manual publish | Relies on Control System sync + catalog | `src/lib/releases.js` `getDisplayDate` shows “Upcoming · …” when date future or `status === "scheduled"` (lines 36–43) |
| Pre-release locked card + countdown | **PARTIAL** | `isUpcomingReleaseDate` + turquoise glow on albums (`CatalogGrid.js`); **no** release countdown timer on cards |
| Early access collector/subscriber before public | **PARTIAL** | `playback-gate.js` — subscriber/collector/owned slugs; **not** tied to `scheduled_publish_at` |
| Teaser/snippet before release | **PARTIAL** | Catalog `preview` URLs (`catalogMedia.js`); no dedicated pre-release gate UI |
| Scheduler → entitlement auto-grant | **MISSING** | Purchases/grants via Stripe webhooks, not schedule cron |

### A27 Matrix

| Item | Status |
|------|--------|
| Scheduled auto-publish (Control System) | **EXISTS** |
| Storefront upcoming display | **PARTIAL** |
| Locked pre-release card + countdown | **MISSING** |
| Tier early access before street date | **MISSING** |
| Public teaser playback gate | **PARTIAL** |
| Schedule → auto entitlement grant | **MISSING** |

---

## A28 — Collector Card Visual and Animation

### Components

- `src/components/collectors-cards/CollectorCardItem.js` — video/image face, `collector-card-sheen` when motion allowed (lines 26–67)
- `CollectorCardModal.js` — purchase modal (Stripe)
- `CollectorsCardsGrid.js`, `collectorCardCatalog.js` — static catalog, edition sizes, accent colors
- Page: `src/app/collectors-cards/page.js`
- CSS: `globals.css` `.collector-card-frame`, `.collector-card-sheen` (~1463+)

### Answers

1. **Animated or static?** **PARTIAL** — sheen animation + optional looping video (`faceType: "video"` on Love Hz card).
2. **Unique art, animation, rarity?** **EXISTS** — per-card artwork/video, `editionSize`, `accentColor`; label `1 of N`.
3. **Changes music player/modal visually?** **MISSING** — player shows gift badge only; no collector skin.
4. **Detail page vs badge?** **PARTIAL** — dedicated `/collectors-cards` + modal; no per-card `/collector/[id]` detail route.
5. **Shows what owner unlocked?** **PARTIAL** — benefits list in modal; ownership via `owns()` / account state, not a rich “unlocks” panel on card.

### A28 Matrix

| Item | Status |
|------|--------|
| Card grid visual / motion | **EXISTS** |
| Rarity / edition | **EXISTS** |
| Player/modal visual tie-in | **MISSING** |
| Owner unlock summary on card | **PARTIAL** |

---

## A29 — Fan Profile and Listening History

### Search results

- **Profile:** `activeTab==="account"` in `page.js` (lines 2367–2386) — name, email, status badge, purchase count, circle posts, links. **No** `/profile` or `fan-profile` route.
- **Listening:** `src/lib/listening-history.js` (localStorage rails + position map), `src/hooks/useListeningHistory.js`, `MyMusicTab.js` consumes rails, `ContinueListening.js`
- **Server:** `media_playback_progress` table (`20260516235849_notification_retention_infrastructure.sql` lines 112–127): `user_id`, `product_slug`, `position_seconds`, `duration_seconds`, `completed`, `replay_count`, `last_played_at`
- **Account state:** `src/app/api/account/state/route.js` exposes `mediaProgress` from `media_playback_progress`

### Answers

1. **Fan profile page?** **PARTIAL** — account tab only, not standalone profile.
2. **Own listening history (tracks, count, duration)?** **PARTIAL** — continue/recently played rails in My Music; server progress per slug; no full analytics dashboard.
3. **Ownership history?** **PARTIAL** — library + purchases in account state / My Music; not a dedicated ownership timeline.
4. **Listening data in Supabase?** **EXISTS** — `media_playback_progress`, `media_stream_events`.
5. **First listen date per track per user?** **PARTIAL** — `created_at` on progress row (first upsert), not a separate `first_listened_at` column.

### A29 Matrix

| Item | Status |
|------|--------|
| Fan profile page | **PARTIAL** |
| Listening history UI | **PARTIAL** |
| Ownership history UI | **PARTIAL** |
| Supabase listening tables | **EXISTS** |
| First-listen per track | **PARTIAL** |

---

## A30 — Vault Visual Environment

### Components & routes

- `VaultUnlockedRoom.jsx`, `VaultUnlockedShelf.js`, `VaultNavLockIcon.js`
- `src/app/api/public/vault/route.js`, `api/vault/content`, `api/vault/media`, `api/vault/progress`
- `src/lib/vault/access.js`, `useVaultMedia.js`, `vault-audio.js`

### Answers

1. **Distinct from storefront?** **PARTIAL** — unlocked room has shelf/glow styling (`vault-unlocked-room` CSS); **vault tab** (`activeTab==="vault"`, lines 2128–2134) is empty placeholder text. Real vault UI appears under **Inner Circle** when `publicVault.unlocked` (lines 2339–2346).
2. **Entering vault — transition?** **MISSING** — tab switch / conditional render; no dedicated transition animation.
3. **Content types?** **PARTIAL** — schema supports vault content; shelf shows cover + metadata (`VaultUnlockedShelf.js`); video/audio via vault APIs and `vault-audio.js`.
4. **Same audio engine?** **EXISTS** — `AudioContext` / `MediaEngine`; vault uses same playback stack with `media_type: 'vault'` in progress.
5. **Feels like a place vs gated list?** **PARTIAL** — `VaultUnlockedRoom` “Archive shelves” copy and 3D-ish objects when unlocked; home/vault tabs still say “empty”.

### A30 Matrix

| Item | Status |
|------|--------|
| Distinct visual environment | **PARTIAL** |
| Entry transition | **MISSING** |
| Multi-type vault content | **PARTIAL** |
| Shared audio engine | **EXISTS** |
| Place-like UX (vs list) | **PARTIAL** |

---

## Key Code References

### Admin-only gift sheet

```1166:1168:src/app/page.js
  const openGiftSheet = useCallback((release) => {
    if (!isAdmin) return;
    setGiftSheetRelease(release);
```

### Gifts table schema (excerpt)

```11:29:supabase/migrations/20260522140000_gifting_system.sql
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  ...
  sender_id uuid references auth.users (id) on delete set null,
  recipient_id uuid references auth.users (id) on delete set null,
  recipient_email text not null,
  ...
  claimed boolean not null default false,
  claimed_at timestamptz,
  ...
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired', 'revoked'))
);
```

### Vault tab placeholder vs Inner Circle room

```2128:2134:src/app/page.js
              {activeTab==="vault" && (
                <>
                  <h2 className="section-heading">Vault</h2>
                  <div ...>
                    <p ...>The Vault remains empty for now...</p>
```

```2339:2346:src/app/page.js
                          {publicVault?.unlocked ? (
                            <div style={{marginBottom:32}}>
                              <VaultUnlockedRoom
                                sections={publicVault.sections || []}
```

### Global player (persists across tabs)

```37:46:src/app/layout.js
              <AudioProvider>
                ...
                      <GlobalAudioPlayerBar />
```

---

## Repositories Audited

- `/Users/recharge/artist-platform` — full read-only scan
- `/Users/recharge/2MRRW-Control-System` — gift, release schedule, admin panels

---

*End of report — sections A25 through A30 inclusive.*
