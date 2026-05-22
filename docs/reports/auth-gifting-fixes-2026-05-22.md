# Auth + Admin Gifting Fixes — 2026-05-22

## FIX 1 — Auth validation + OTP enforcement

| Item | Implementation |
|------|----------------|
| **1A** | `src/lib/auth/validation.js` — email regex, phone 10+ digits; inline `#ef4444` errors on `/join`; submit blocked when invalid |
| **1B** | Account tab no longer calls `enterGuest`; routes to `/join` → OTP → `refreshAccountState`. Verified users only (`!isGuest`) see account dashboard |
| **1C** | `/verify-otp` resend countdown `Resend code in 0:28` format; active resend via Supabase; text `#00ffff` |
| **1D** | `/login` redirects authenticated OTP users to `/` |
| **1E** | `isAdmin` in `AuthContext`; set immediately on verify for admin UUID; `permissions.admin` from `/api/account/state` |

## FIX 2 — Admin-only storefront gifting

| Item | Implementation |
|------|----------------|
| **2A** | `GiftButton` on singles carousel, features rail, albums grid when `isAdmin` |
| **2B** | Same button in `ImmersivePreviewModal` |
| **2C** | `GiftBottomSheet` — keyboard-safe scroll, pinned Send, validated email, `POST /api/gifts/send` |
| **2D** | `sendStorefrontGift` inserts `gifts` row, emails link; auto-`claimGiftForUser` / `grantLibraryItems` when recipient profile exists |
| **2E** | Account tab **GIFTS SENT** (admin only) via `GET /api/gifts/sent` |

Admin ID: `545cd959-5cae-4009-8a91-1c46fe2f4d27` · Email: `book2mrrw@gmail.com`

## Final checks

| # | Check | Status |
|---|--------|--------|
| 1 | Wrong phone rejected | Pass — `validatePhone` on join + account CTA |
| 2 | No OTP = no access | Pass — account dashboard requires `!isGuest` OTP user |
| 3 | Admin email → `isAdmin` | Pass — ID/email match in `isAdminUser` |
| 4 | Gift hidden non-admin | Pass — `isAdmin` gates UI + API 403 |
| 5 | Send visible with keyboard | Pass — sheet scroll + fixed footer |
| 6 | Resend countdown | Pass — `formatResendCountdown` |
| 7 | Logged-in redirect from login | Pass — `getUser` → `router.replace("/")` |

## Build

`npm run build` — **exit 0**

## Control system

No changes required (send/revoke already in 2MRRW-Control-System; storefront uses local `/api/gifts/send`).
