# Step 2 — User object vs isAdminUser (static / unit, no deploy)

Prompt Step 2 asked for a temporary `console.log` in `validateStreamEntitlement`, deploy, and one live hit.
This run was **read-only**: no debug log added, no deploy (parent scope: diagnose only; fix already on `main` at `e85ecc8`).

## Session user shape from `getFanSessionUser()`

```json
{
  "id": "<supabase auth user id>",
  "email": "<profiles.email || auth.email>",
  "authEmail": "<supabase auth email>",
  "phone": "...",
  "name": "...",
  "isGuest": false,
  "isOtp": true,
  "role": "<profiles.role || 'user'>"
}
```

Source: `src/lib/auth/session-user.js` lines 19–28.

## Simulated failing case (pre-e85ecc8)

When `profiles.email` ≠ `book2mrrw@gmail.com` but Supabase auth email is admin:

```json
{
  "id": "545cd959-5cae-4009-8a91-1c46fe2f4d27",
  "email": "fan-display@example.com",
  "authEmail": "book2mrrw@gmail.com",
  "role": "user"
}
```

| Check | Pre-fix (email only) | Current (email + authEmail) |
|-------|----------------------|-----------------------------|
| `isAdminUser(user)` | false | **true** |

## Simulated log output (equivalent to Step 2)

```
[stream debug] user object: {"id":"545cd959-...","email":"fan-display@example.com","authEmail":"book2mrrw@gmail.com","role":"user"}
[stream debug] isAdminUser result: true
```

(With pre-fix code, second line would be `false` → `userCanStreamProduct` → 403.)
