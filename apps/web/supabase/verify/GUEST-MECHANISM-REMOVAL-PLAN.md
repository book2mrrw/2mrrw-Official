# Guest mechanism removal — scope

Prepared 2026-08-22. **Scope only. Nothing has been deleted or deployed.**

---

## The finding

The platform has five principal tiers: **Entry, Purchaser, Subscriber, Collector
card owner, Admin.** There is no guest tier. `AuthGate` exists specifically so
nobody uses the app without signing in.

The guest mechanism is therefore **dead by design**, and the code proves it:

| Evidence | Where |
|---|---|
| A guest is classified **unauthenticated** even holding a valid cookie | `context/AuthContext.js:700` — `if (user.isGuest === true) return "unauthenticated"` |
| Unauthenticated + non-auth route ⇒ undismissable gate | `components/auth/AppAuthRoot.js:34` — `<AuthGate variant="root" open />` |
| The root variant cannot be dismissed | `AuthGate.js:300,305-308,310` — `isRoot` disables backdrop click, drag, and close |
| `AuthGate` offers no guest path | no occurrence of "guest" in the file; only Continue / Create account / Forgot password |
| `enterGuest` is unreachable | sole caller is `CollectorCardModal.ensureIdentity`, which runs only when `!currentUser` — exactly when the gate is covering the app |
| No new guests in ~3 months | newest guest record **2026-05-27** |

So `POST /api/guest/session` still mints session cookies for a principal class
the application refuses to admit. That is an authentication surface with no
legitimate caller — the same shape as the legacy seed routes, and it should reach
the same end state: **the endpoint does not exist.**

---

## What must NOT be deleted

`lib/guest-session.js` is imported by **34 files**, including protected playback
and vault routes. It cannot be removed wholesale. The real resolver is:

```
getFanSessionUser()                       lib/auth/session-user.js
  ├─ Supabase session, non-guest email → registered principal, isAdmin resolved
  └─ else                               → getGuestUser()   (legacy cookie)

routes:  (await getFanSessionUser()) ?? (await getGuestUser())
```

**Every tier — Entry, Purchaser, Subscriber, Collector, Admin — resolves through
the Supabase branch.** The guest cookie is a fallback tier only. Removing guest
*minting* therefore does not touch how any real principal authenticates.

Keep:

| Symbol | Why |
|---|---|
| `getFanSessionUser()` | the actual authority resolver for all five tiers |
| `getRequestUser()` | Supabase-first; its guest fallback becomes dead but the function is used by 8 routes |
| `getGuestUser()` | required until legacy cookies are gone; removable in a later pass |
| `clearGuestCookie` / `clearGuestCookieOnResponse` | needed so sign-out clears legacy cookies |
| `normalizeEmail` / `normalizePhone` | used outside the guest path |

---

## What is deletable

### Server — guest minting surface

- `POST /api/guest/session` — both the identity-assertion and proof branches.
  `GET` (read cookie) and `DELETE` (clear cookie) are still called by
  `AuthContext` and must survive until legacy cookies are retired.
- `createOrRetrieveGuest`, `findExistingGuest`, `withGuestCookie`,
  `syntheticAuthEmail`, `findGuestBySyntheticEmail` — in `lib/guest-session.js`
- `lib/auth/guest-proof.js` — entire file
- `src/app/api/gifts/redeem/route.js` — **zero callers**; the live gift path is
  `preview → claim / claim-signup`, and none of those three import
  `guest-session`. The live path is already guest-free.

### Client — the possession-proof work built 2026-08-22

All of it targets an unreachable flow and should go with the mechanism:

- `components/auth/OtpCodeForm.js`
- `components/auth/GuestPossessionFlow.js`
- `lib/auth/guest-entry-contract.js`
- `enterGuest` / `verifyGuestProof` / `adoptAuthenticatedUser` in `AuthContext.js`
- the identity form and challenge state in `CollectorCardModal.js`
- `lib/auth/__tests__/guest-proof-contract.test.js` (29 tests)
- `e2e/guest-possession.spec.mjs`, `playwright.config.mjs`, and the
  `@playwright/test` dev dependency

Note `OtpCodeForm` is the only reusable piece. The `/verify-otp` login page has
its own inline implementation and does **not** import it, so removing it costs
nothing today. Keep it only if a login-OTP refactor is planned.

### Configuration

- `GUEST_SESSION_SECRET` — after legacy cookies are retired
- `GUEST_SESSION_SECRET_PREVIOUS` — never set; keep it that way

---

## Migration invariants — adopted 2026-08-22

**INV-ID-MIG-1** — A principal cannot be merged, retired, or deleted until every
database object referencing that principal identity has been **enumerated and
classified**.

**INV-ID-MIG-2** — A successful merge requires **zero residual references** to
the source principal across the complete dependency graph.

### Why these exist — three successive scoping failures

The same mistake was made three times in one session, each time by hand-picking
tables instead of deriving them:

| Pass | Claimed | Actually |
|---|---|---|
| 1 | "3 tables cover it" — `library_items`, `purchases`, `gift_redemptions` | missed `entitlements` and `gifts.recipient_id`; a merge would have left entitlement rows on the source — split-brain identity |
| 2 | "14 principals are entitlement-empty" | only **7** were; the sweep probed 37 tables but only 4 column *names* |
| 3 | "7 are truly empty" | **none** were — every principal has a `profiles.id` row, never checked |

Each pass looked thorough and each was wrong. That is the argument for tooling:
a hand-built list cannot be audited for what it omits.

### The tool

`supabase/verify/principal-dependency-sweep.mjs`

- **`--inventory`** — parses every `references auth.users` FK out of the
  migration SQL, with its `ON DELETE` behaviour. **41 declared FKs**, plus a live
  probe for columns present in the database but absent from source.
- **`--audit <id>…` / `--audit-guests`** — every reference held by a principal,
  aggregated and classified.

Enumeration alone does not support a decision, so each reference is classified:

| Class | Meaning | Delete behaviour |
|---|---|---|
| **VALUE** | ownership, money, entitlement | **blocks deletion** — reassign first or value is destroyed |
| **HISTORICAL** | immutable measurement | survives via `set null`; stamp provenance first if attribution matters |
| **STATE** | per-account working state | safe to cascade — meaningless without a live account |
| **DERIVED** | bookkeeping that exists only because the principal did | safe to cascade |

The verdict follows: **BLOCKED** if any VALUE reference exists, **TOMBSTONE** if
only HISTORICAL, **DELETABLE** otherwise.

### OPS-01 finding

The live probe found **`ticket_purchases.user_id`** present in the database but
declared in no migration — the same class of problem as `login_otp`. Carried to
F0.

---

## Entitlement migration — EXECUTED 2026-08-22

Started at 18 principals. **14 resolved, 4 preserved.**

| Principal | Action | Result |
|---|---|---|
| `kevin.morrow@sbcglobal.net` | **MERGED** into registered `5b3e7bce` | 3 rows reassigned (`entitlements`, `library_items`, `gifts.recipient_id`), zero collisions, zero residue, guest deleted |
| `cursor-gift-final@example.com` | **DELETED** — confirmed test | gift link literally titled *"Cursor Final Gift Test"*; link → principal → grant → redemption in **0.9 s** |
| 11 × test principals | **DELETED** | `@example.com` / `@2mrrw.test`, never signed in, DERIVED references only |
| `selenam33!` | **TOMBSTONED** | see below |
| `asd@gmail.com`, `yuungvett@gmail.com` | **PRESERVED** | zero-row, real-looking; retention rule deferred to F0 rather than invented here |
| `kastaway214@gmail.com` | **PRESERVED** | BLOCKED — holds `entitlements` + `library_items` + `gifts.recipient_id` |
| `callme2mrrw@gmail.com` | **PRESERVED / HELD** | BLOCKED — see ownership question below |

### The Kevin case, and why it mattered

The gift's `sender_id` is `f20fff42` (the admin). A gift was sent to
`kevin.morrow@sbcglobal.net`, bound to a **guest** principal; Kevin registered a
real account the same day. His gift was invisible to him — he saw an empty
library. The merge fixed a live user-visible bug, not just a data-tidiness issue.

### `selenam33!` — tombstoned, not erased

`contact_email` is literally `selenam33!` — not an address, so no claim path can
ever exist. The schema already encoded the right disposition:

| Table | FK | Meaning | Outcome |
|---|---|---|---|
| `media_playback_progress` | `on delete cascade` | resumable per-account state | **cascaded away** (1 row) — nobody can reclaim the identity |
| `media_stream_events` | `on delete set null` | immutable historical measurement | **preserved** (11 rows) |

`SET NULL` preserves the events but destroys *attribution* — the ability to group
them as one listener. So before deletion, each event's `metadata` was stamped:

```json
{ "retired_principal": "d4f41ba7-…",
  "retired_at": "2026-08-22T…",
  "retired_reason": "unrecoverable identity: contact_email is not an address; no possible claim path" }
```

Verified after deletion: 11 events survive, `user_id` is `NULL`, and they remain
groupable by an immutable internal id that is no longer an authentication
principal. Removed from authentication, recovery and ownership authority;
retained as analytics.

### `callme2mrrw@gmail.com` — held, needs your decision

Not merged, because the target is genuinely ambiguous:

- contact_email is exactly `callme2mrrw@gmail.com`; name "2MRRW"; Dallas, Texas
- a **real purchase**: $2.99, `pi_3TZN6wHaORhXdjoA0SmuWqLh`, `completed`,
  "Hour Glass", 2026-05-21 — and a `stripe_customers` row
- **no registered account exists with that email**; the active admin account is
  `book2mrrw@gmail.com` (`f20fff42`)

Real money under that address, but nothing to merge *into*. Merge to
`book2mrrw@gmail.com`, or hold until `callme2mrrw@gmail.com` registers?

**These entitlements are already unreachable today** — AuthGate blocks their
principals and no guest recovery path exists. The migration fixes a pre-existing
stranding, it does not mitigate anything the removal causes.

Migration shape (one transaction per principal):

```
reassign  library_items.user_id     guest_id -> target_id
reassign  purchases.user_id         guest_id -> target_id
reassign  gift_redemptions.user_id  guest_id -> target_id   (unique(gift_link_id,user_id) — check collision first)
then      delete the guest auth.users row
```

`gift_redemptions` carries `unique (gift_link_id, user_id)`, so a reassignment
collides if the target already redeemed that link. Check before updating.

---

## The Kevin class — retroactive sweep and the durable fix

*"What you did for Kevin needs to apply to all users who had the same issue, and
any future account holders."*

### Root cause

`lib/gifts/send-gift.js:15`

```js
const { data: profile } = await admin
  .from("profiles").select("id, email, full_name")
  .ilike("email", email)
  .maybeSingle();
```

`profiles` holds rows for **both** guest and registered principals keyed by the
same real email, and this lookup cannot tell them apart — so a gift binds to
whichever row exists. Two defects in four lines:

1. **No principal-class discrimination.** A guest row wins if it was created first.
2. **`.maybeSingle()` on a non-unique match, with the error discarded.** The
   destructure takes `data` only; when two rows match, PostgREST errors,
   `profile` is `undefined`, and the gift silently gets `recipient_id: null`.

### Retroactive sweep — complete

| Population | Count | Status |
|---|---|---|
| Duplicate `profiles.email` rows | **0** | no live collisions |
| Gifts bound to a guest principal | **3** | all belong to the 2 held principals; resolved when those merge |
| Unclaimed gifts with `recipient_id = NULL` whose email now has an account | **8** | **not broken** — see below |

The 8 are fine. Authorisation for an *unclaimed* gift is by **email match**
(`claim/[token]/route.js:88-97`), not by `recipient_id`, and `claimGiftForUser`
writes `recipient_id` at claim time. A null recipient is a cache miss, not a lock-out.

### The actual defect, and the durable fix

The failure is specific to an **already-claimed** gift:

```js
if (state === "claimed") {
  const sessionUser = await getFanSessionUser();
  if (sessionUser && sessionUser.id === gift.recipient_id) { …recover… }
  return 409 "This gift has already been claimed";
}
```

No email fallback. A gift claimed under a superseded principal returns **409 to
its rightful owner, permanently** — exactly what Kevin experienced. Deleting the
guest mechanism removes today's source of superseded principals, but it does not
make this branch correct; any future principal change reintroduces it.

Two changes, both narrow, both on live code:

1. **`findRecipientProfile`** — resolve only real principals, and surface
   ambiguity instead of swallowing it. Ranking must be deterministic, and a
   multi-match must raise rather than silently produce `recipient_id: null`.
2. **The `claimed` branch** — fall back to `recipient_email` match when
   `recipient_id` does not match the session user. Email is already the
   authorisation basis for the unclaimed path; making the claimed path agree
   removes the asymmetry that stranded Kevin.

**Not yet implemented — awaiting approval**, because this is a live
payment/entitlement path.

---

## Effect on E1

| Item | Revised status |
|---|---|
| Rotate `GUEST_SESSION_SECRET` | **blast radius is effectively zero** — guest cookies already authenticate nobody, because `authStatus` treats guests as unauthenticated. Rotation invalidates inert credentials. Deleting the mechanism supersedes rotating its key. |
| "18 guests all recoverable via possession proof" | **withdrawn** — they cannot reach that flow |
| The 2026-08-22 deploy blocker | **overstated** — the client gap was real, but it gated a path with no reachable entry point |
| PLAT-02 / GIFT-01 | unchanged as *code*; the surfaces they hardened are dead and should be deleted rather than carried |
| AUTH-01 / AUTH-02 | unaffected — login 2FA is the live path and still needs deploying |

`login_otp` and `consume_login_otp` **stay**: login 2FA uses them, and the
18/18 live gates certifying them remain valid.

---

## Proposed sequence

1. Confirm the disposition of the four principals above (two need your identification).
2. Run the entitlement migration; delete the 14 empty guest records.
3. Delete the guest minting surface + `gifts/redeem` + the 2026-08-22 client work.
4. Rebuild, re-run suites, confirm no importer of a removed symbol survives.
5. Deploy — this is also when AUTH-01/AUTH-02's application half lands.
6. After one cookie lifetime with no guest resolution in logs: remove
   `getGuestUser`, the `GET`/`DELETE` guest-session route, and
   `GUEST_SESSION_SECRET`.
7. Resume the E1 closure sequence at MFA.

---

## Carried to F0

The synthetic-email identity question is now **moot for guests** — the mechanism
is being removed rather than indexed. What survives into F0 is the general rule
it illustrated: a derived, unindexed value must never be load-bearing identity.
Check the remaining principal paths against it.
