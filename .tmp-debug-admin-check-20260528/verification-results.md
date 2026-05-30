# Verification — admin check debug 2026-05-28

## Unit: `isAdminUser` (local Node, current tree)

| Case | Expected | Result |
|------|----------|--------|
| `email: book2mrrw@gmail.com` | true | PASS |
| `email: fan@…`, `authEmail: book2mrrw@gmail.com` | true | PASS |
| `email: fan@…`, no `authEmail` | false | PASS |
| `id: ADMIN_USER_ID`, other email | true | PASS |
| `role: admin`, other email | true | PASS |
| `null` | false | PASS |

## Code-path review (current tree)

| Path | Admin recognized? |
|------|-------------------|
| `validateStreamEntitlement` → `isAdminUser(user)` early return | Yes |
| `userCanStreamProduct` → `isAdminUser(user)` | Yes |
| `userCanStreamProduct` → `resolveAdminFromProfile` (role/email on profile) | Yes, even when session object fails |
| `/api/account/state` → `permissions.admin` | Same `isAdminUser(user)` |
| `GET` / `HEAD` stream (shared handler) | Same entitlement gate |

## Prior production verification (e85ecc8 deploy)

From `.tmp-stream-403-fix-20260528/verification-results.md`:

- `HEAD /api/library/stream?slug=w2d&redirect=1` → 200
- `GET /api/library/stream?slug=w2d&redirect=1` → 200

## Build / commit this run

- **Code changes:** none (read-only audit)
- **Build:** not run (no edits)
- **Commit:** none (prompt did not request commit/deploy)
