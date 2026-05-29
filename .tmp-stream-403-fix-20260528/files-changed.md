# Files changed

| File | Change |
|------|--------|
| `src/lib/auth/constants.js` | `isAdminUser` now checks both `email` and `authEmail` (Supabase auth email) |
| `src/lib/auth/session-user.js` | Session user includes `authEmail: user.email` for admin detection |
| `src/lib/commerce/entitlements.js` | `userCanStreamProduct` always reconciles admin from `profiles` when session check fails |
| `src/app/api/library/stream/route.js` | Admin short-circuit in `validateStreamEntitlement`; documented HEAD handler |

## Preserved (unchanged)

- `src/lib/server/r2-stream-proxy.js`
- `src/lib/server/media-cors.js`
- Entity-folder / features playback key resolution
- `site-api-url.js`
- AudioContext orchestration
- Auth OTP flow
