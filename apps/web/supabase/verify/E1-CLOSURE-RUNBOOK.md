# E1 closure runbook

Status as of 2026-08-22, after live certification of the database layer.

| Step | State |
|---|---|
| Offline suites | **360 / 360** (331 + 29 new contract tests) |
| E1 migration applied (rev 3) | **done** |
| Step 0 — signature STOP gate (S1–S3) | **done — 3 / 3 live** |
| Step 3 — OTP concurrency (T0–T5) | **done — 11 / 11 live** |
| Bonus — attacker-side wire proof (A1–A4) | **done — 4 / 4 live** |
| **Step 0.5 — 2FA smoke test** | **URGENT — see below** |
| Step 1b — required secrets | **done — both set 2026-08-22** |
| Step 1c — SVC_* capabilities | **done — none configured, all fail closed** |
| Step 1a — secret independence | **UNVERIFIABLE — `sensitive`-flagged; rotation APPROVED 2026-08-22** |
| Step 1.4 — proof flow client | **RESOLVED 2026-08-22 — 4/4 parts, 360/360 tests** |
| Step 1.4b — browser certification | **pending — Playwright not installed** |
| E1 production build | **verified — `next build` exits 0** |
| Step 1.5 — DEPLOY the E1 code | **pending — code is NOT in production** |
| Step 2 — production behaviour verified | pending |
| Step 4 — admin MFA enrolled + `required` | pending |
| Step 5 — legacy route disposition | pending |
| Step 6 — E0 regression 13/13 | pending |
| Rotate the exposed service role key | **pending — see Step 7** |
| **E1 CLOSED** | **NO** |

**Live gates passed: 18 / 18.** All of them certify the *database* layer. The
application layer is unverified because it is not deployed.

---

## The deployment gap — read this first

`vercel ls` shows the most recent production deployment at **23 hours old**,
which predates every E1 source edit. So production currently runs:

- the **new database** (migration applied, 4-arg `consume_login_otp`, `login_otp`
  under RLS with zero policies)
- the **old application code**

Consequences:

1. **AUTH-02 is not fixed in production.** The atomic primitive exists and is
   certified, but the deployed `login-step2` still performs the JavaScript
   read-modify-write. The race is live until Step 1.5.
2. **PLAT-01, PLAT-02, GIFT-01, AUTH-01 are not fixed in production.** Their
   fixes are entirely application-side.
3. The two absent secrets are **not** breaking anything yet, because the code
   that requires them is not deployed. They must be set *before* Step 1.5.

E1 certifies five blockers. One (AUTH-02) is half-certified — its database half
is proven, its application half is not deployed. The other four are not live at
all. This is why E1 is open.

---

## Step 0.5 — smoke-test 2FA login NOW · MANUAL

The migration dropped `consume_login_otp(uuid, text, integer)`. If the deployed
build calls the RPC with three arguments, every 2FA login is now failing with
`PGRST202`.

The expected situation is that it does **not** call the RPC at all — the RPC was
introduced by E1 and the deployed build predates it — in which case 2FA works and
the old race is simply still present. But that reasoning is inference, not
observation, and a broken login path is not something to infer.

**Do one real 2FA login against production.**

- **Works** → the deployed build uses the old inline path, as expected. Proceed.
- **Fails** with a code/verification error → the migration broke a live path.
  Deploy Step 1.5 immediately; that is the fix, not a rollback.

---

## Step 1 — configure independent secrets · VERCEL

Verified against live Vercel on 2026-08-22:

| Variable | State in production |
|---|---|
| `GUEST_SESSION_SECRET` | **present** (created 98d ago) |
| `ADMIN_SEED_SECRET` | **present** (created 98d ago) |
| `GIFT_REMINDER_SIGNING_SECRET` | **SET 2026-08-22** — fresh 32-byte random, `sensitive` |
| `COLLECTOR_CARD_HASH_SECRET` | **SET 2026-08-22** — fresh 32-byte random, `sensitive` |
| `GUEST_SESSION_SECRET_PREVIOUS` | absent — see below, may not be needed |
| `ADMIN_MFA_POLICY` | absent — correct, Step 4 sets it |
| `LEGACY_SEED_ROUTES_ENABLED` | absent — correct, keep it that way |
| 7 × `SVC_*` | absent — set only what you actually run |

### 1a. Independence cannot be verified — and that decides the action

Two prior instructions in this runbook were wrong and are withdrawn:

1. *"Set `GUEST_SESSION_SECRET_PREVIOUS` to the old `ADMIN_SEED_SECRET` value."*
   That assumed `GUEST_SESSION_SECRET` was unset so the pre-E1 expression
   `GUEST_SESSION_SECRET || ADMIN_SEED_SECRET` fell through. It has existed since
   2026-05-16, so the fallback never fired and cookies are already signed with
   `GUEST_SESSION_SECRET`.
2. *"Reveal both values in the Vercel dashboard and compare them."* **This is not
   possible.** Both variables are `type: "sensitive"` in Vercel — a write-only
   class whose value is never returned by the API, the CLI, or the dashboard.
   Nobody can read them, including the account owner.

Verified 2026-08-22 against the Vercel API with `decrypt=true`: both return no
value and are typed `sensitive`. Both were created 2026-05-16 20:44 and neither
has been rotated since.

So the independence of `GUEST_SESSION_SECRET` from `ADMIN_SEED_SECRET` is
**permanently unverifiable by inspection**. Under the standard this program runs
on, an unverifiable security property is an open hole, not a pass.

The only way to establish independence is to make it true by construction:
**rotate `GUEST_SESSION_SECRET` to a fresh random value.**

**Blast radius, measured rather than assumed** (2026-08-22):

| | |
|---|---|
| `auth.users` total | 32 |
| guest identities | 18 |
| guests with a `contact_email` on record | **18 — all of them** |
| guests with no delivery address | 0 |

Every affected guest can recover through the possession-proof challenge, because
`findExistingGuest` returns `user_metadata.contact_email` (the real address), not
the synthetic `@guest.2mrrw.local` auth email. Cost of rotation is therefore one
email re-verification for at most 18 identities.

**Do not set `GUEST_SESSION_SECRET_PREVIOUS`.** It would double the valid signing
surface to spare 18 users a recoverable re-verification, and the old value cannot
be read to populate it anyway.

**Sequence it with the deploy** so guests experience one disruption, not two.

### 1b. Required secrets — DONE

Both were absent and are now set as fresh 32-byte random values, `sensitive`,
production-scoped, generated locally and never printed:

```
GIFT_REMINDER_SIGNING_SECRET   set 2026-08-22
COLLECTOR_CARD_HASH_SECRET     set 2026-08-22
```

### 1c. Service capabilities — set NONE

Determined by code analysis, 2026-08-22. All seven capabilities are wired to
routes, but the guard type decides what happens when the secret is absent:

| Guard | Routes | Behaviour when unset |
|---|---|---|
| `requireServiceCapability` | catalog-sync, drop-notification, catalog-revalidate, r2-ingest, diagnostics-parity | route unreachable by anyone |
| `requireAdminOrCapability` | fulfill-recovery, seed-products | **still reachable by a signed-in admin** |

Two facts close the question:

- **No cron calls any of them.** All six entries in `vercel.json` are
  `/api/cron/*`, authorised by `CRON_SECRET`, not by any `SVC_*`.
- **No in-repo caller exists** for any of the seven, excluding tests and build
  artifacts.

So none are configured. Admin workflows keep working through the two
`requireAdminOrCapability` routes; everything else fails closed. If an external
integration does call one, it surfaces as `capability_not_configured` in
production logs — the same discovery signal the retired routes use.

Do not set one to silence an error you have not diagnosed.

---

## Step 1.4 — the proof flow had no client · FOUND AND FIXED 2026-08-22

**Resolved — see "RESOLVED 2026-08-22" below.** Recorded in full because it is
the most instructive failure in this program: it was invisible to 331 passing
tests, and the fix is structural rather than local.

Found by building the E1 code and tracing the route manifest.

The server side of the possession-proof flow is complete and correct:

- `api/guest/session/route.js:102` issues the challenge
- `api/guest/session/route.js:56-85` consumes it and mints the session
- both are exercised by the 331 offline suites

**The client implements only the first half.** `AuthContext.enterGuest`
(`src/context/AuthContext.js:551`) does:

```js
const res  = await fetch("/api/guest/session", { method:"POST", body:{email,phone,name} });
const data = await res.json();
if (!res.ok) throw new Error(data.error || "Could not enter");
setUser(data.user);
```

`PROOF_REQUIRED` is returned with **HTTP 200** (route.js:103, default status), so:

| | |
|---|---|
| `res.ok` | `true` — no error is thrown |
| `data.user` | `undefined` |
| `setUser(undefined)` | the app treats the visitor as signed out |
| `challengeId` | silently discarded |
| UI prompt for the code | **does not exist** |

A repository sweep confirms it: `PROOF_REQUIRED` and `challengeId` appear nowhere
outside `src/app/api/**` and `src/lib/auth/guest-proof.js`. There is no component,
no page, and no context method that can complete a challenge.

### Why this blocks

The currently deployed build returns a session directly from
`/api/guest/session` — the takeover behaviour E1 exists to remove — so guest
re-entry *works today*. Deploying E1 replaces that with a challenge the client
cannot answer.

**E1 would regress guest re-entry from "works, insecurely" to "silently fails."**

| Scenario | Affected |
|---|---|
| Deploy without rotation | any existing guest whose cookie is missing or expired |
| Deploy **with** the approved rotation | **all 18 guests, immediately on next visit** |

The rotation is still the right call. It just cannot land before the client can
complete a challenge, or it converts a correct security decision into a lockout.

`api/gifts/redeem/route.js:51` has the same shape and an additional problem: it
returns `PROOF_REQUIRED` but never checks for an existing session, so even a
verified guest re-submitting would be challenged again. It currently has no
caller, so this is latent rather than live — but it must not be deployed as a
reachable route in that state.

### RESOLVED 2026-08-22 — all four parts implemented

| # | Requirement | Where |
|---|---|---|
| 1 | `enterGuest` returns a typed result, never `setUser(undefined)` | `context/AuthContext.js` |
| 2 | `verifyGuestProof({challengeId, code})` completes the exact challenge | `context/AuthContext.js` |
| 3 | Six-digit proof UI | `components/auth/OtpCodeForm.js` + `GuestPossessionFlow.js` |
| 4 | `gifts/redeem` resolves an authenticated principal first | `api/gifts/redeem/route.js` |

**The structural fix, beyond the bug fix.** The state strings now live in one
module, `lib/auth/guest-entry-contract.js`, imported by *both* the route and the
client. A rename cannot desynchronise producer from consumer because there is
only one definition. The response interpretation is a pure function in that same
module rather than inline logic inside a React hook — which is what makes the
security decision executable in a test without a browser, the exact coverage that
was missing.

**Authority separation held.** `OtpCodeForm` is presentation only — no `fetch`,
no `useAuth`, asserted by test G7.1. Login MFA and guest possession share the
visual shell and nothing else: different endpoint, different challenge type,
different resulting authority. The `/verify-otp` page was **not** refactored;
touching a working login path was outside the approved scope.

**Challenge lifecycle**, all encoded and tested:

| Event | Behaviour |
|---|---|
| close / unmount | challengeId dropped; never resumed |
| refresh | same — state is in memory only, never `sessionStorage` or a URL |
| wrong code | `attemptsLeft` shown, flow continues |
| lockout / expiry | terminal; entry disabled; only a new challenge proceeds |
| request another code | re-asserts identity → NEW challengeId; server deletes the prior unused row |
| email/phone edited | challenge discarded — it is bound to one principal |
| second tab | each holds its own id; rev3's exact-id binding means tab A can never consume tab B's newer OTP |

**Coverage: 360/360** (was 331) — 29 new tests in
`lib/auth/__tests__/guest-proof-contract.test.js`, including **G0, a negative
control** that reproduces the shipped client logic and asserts it *does* mishandle
the fixture. If G0 ever passes cleanly the fixture has drifted and the suite below
it is void.

`next build` exits 0.

### Still outstanding — browser certification

`e2e/guest-possession.spec.mjs` and `playwright.config.mjs` are written and
committed, but Playwright is **not installed**. That is a `package.json` change
plus a browser download and a CI implication, so it awaits approval:

```
npm i -D @playwright/test && npx playwright install chromium
E2E_BASE_URL=<preview> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx playwright test e2e/guest-possession.spec.mjs
```

It drives the real UI, lets the server issue a genuine challenge, then rewrites
that row's `code_hash` to a known value — the code is delivered by email and
stored only as a hash, so it cannot be recovered. Everything else stays real: the
same row, the same atomic `consume_login_otp`, the same binding and session
issuance. Only the delivery channel is bypassed. Point it at a preview, never
production.

---

## Step 1.5 — deploy · TERMINAL

Only after Step 1 **and Step 1.4**. From `apps/web`:

```powershell
vercel --prod
```

This is what actually closes PLAT-01, PLAT-02, GIFT-01 and the application half
of AUTH-02.

Build verified locally 2026-08-22: `next build` exits 0, 143 routes emitted.

---

## Step 2 — verify production behaviour after deploy · MANUAL

1. Sign in normally. Session works.
2. **Guest recovery — not guest persistence.** The earlier revision of this step
   said "guest sessions minted before the deploy still resolve." That is now
   **wrong and inverted**: the approved rotation deliberately invalidates every
   pre-deploy guest cookie, and there is no `GUEST_SESSION_SECRET_PREVIOUS` to
   bridge them. An old cookie that still resolved would mean the rotation did not
   take effect.

   The correct expected sequence is:

   ```
   old guest cookie        → signature invalid → no session
   guest supplies identity → existing guest found
                           → possession challenge sent to stored contact_email
                           → correct proof
                           → NEW session issued
   ```

   Certify **that** path end to end. The old cookie failing is the pass
   condition, not the failure condition.
3. Admin gifts page creates a gift link **without prompting for a secret**.
4. A gift reminder link still opens.
5. Repeat the Step 0.5 2FA login. It must now go through the atomic RPC.

If step 2's challenge email never arrives, check that the guest's
`user_metadata.contact_email` is populated — all 18 current guests have one, so
an absent code means a delivery fault, not a missing address.

---

## Step 3 — OTP concurrency certification · DONE

Run 2026-08-22 against production. **11 / 11.**

| Gate | Result |
|---|---|
| T0 negative control | PASS — `attempts=3` after 50 parallel JS increments, **47 lost** |
| T1 attempts ceiling | PASS — exactly 3 |
| T1 challenge locked | PASS — `used=true` |
| T1 single lockout observer | PASS — `locked=1` |
| T1 no success on wrong code | PASS — `ok=0` |
| T2 single consumption | PASS — `ok=1` of 20 concurrent valid |
| T2 challenge burned | PASS — `used=true` |
| T3 challenge binding | PASS — A consumed, newer B untouched |
| T4 cross-principal isolation | PASS — `expired`, `used=false` |
| T5 expiry | PASS — `expired` |

T0 is the load-bearing one: it lost 47 of 50 updates, which proves the harness
generates genuine contention and the ten gates above it are non-vacuous.

**Note the coincidence:** T0 and T1 both ended at `attempts=3` with opposite
meanings. T0's 3 is *47 lost updates*; T1's 3 is *the correct ceiling*. They are
not the same result and must not be reconciled as one in any later summary.

---

## Step 3b — signature STOP gate · DONE

Executed over HTTP rather than the SQL editor. One probe closes both failure
modes, because a surviving 3-arg overload and a surviving `DEFAULT` are
indistinguishable to a caller — both make a 3-argument call resolve.

| Gate | Result |
|---|---|
| S1 the 3-arg form does not resolve | PASS — HTTP 404 `PGRST202` |
| S2 explicit NULL raises | PASS — HTTP 400 `22004` |
| S3 positive control, 4-arg DOES resolve | PASS — HTTP 200 |

S3 exists so S1's 404 cannot be a blanket 404.

**Repository sweep:** exactly two callers — `lib/auth/guest-proof.js:127` and
`api/auth/login-step2/route.js:86`. Both pass `p_challenge_id`. No caller depends
on newest-by-user semantics. The weaker contract has no surviving consumer.

---

## Step 3c — attacker-side wire proof · DONE

Anon key only, over HTTPS, the way a browser would.

| Gate | Result |
|---|---|
| A1 anon cannot execute `consume_login_otp` | PASS — 401 `42501` |
| A2 anon cannot read `login_otp` | PASS — 401 `42501` |
| A3 anon cannot forge a challenge | PASS — 401 `42501` |
| A4 positive control — key reaches `tracks` | PASS — 200 |

A4 was wrong on the first attempt: it hit `/rest/v1/`, which is service-role-only
by design, so it 401'd for reasons unrelated to authorization and would have made
A1–A3 unfalsifiable. Replaced with a public table the anon key is *supposed* to
reach. The same key returning 200 on `tracks` and 401 on `login_otp` is what makes
A1–A3 per-object authorization decisions rather than a dead credential.

---

## Step 4 — MFA enrolment and enforcement · SUPABASE + TERMINAL

Unchanged, and entirely outstanding. AUTH-01 is not fixed in production.

**4a. Baseline, before enrolling:**

```powershell
$env:SUPABASE_URL      = "https://qvfbgkbgczyqrglvgyqr.supabase.co"
$env:SUPABASE_ANON_KEY = "<publishable key>"
$env:TEST_EMAIL        = "<ADMIN email>"
$env:TEST_PASSWORD     = "<ADMIN password>"
node e1-mfa-check.mjs
```

Expect **FAIL** on *"ADMIN HAS AN ENROLLED FACTOR"* — that is the evidence
AUTH-01 is real.

**4b. Enrol a TOTP factor.** Before enrolling, establish and verify an
administrative recovery procedure. Do not assume recovery codes exist — confirm
what your configured Supabase MFA actually provides, and if it provides nothing
usable, define the procedure yourself (a second enrolled admin principal, or an
operator-only SQL path through `recover_admin_principal`).

The recovery path must satisfy both:

1. It works when the primary factor is lost — otherwise `required` locks you out
   of your own console permanently.
2. It cannot itself bypass the authority model. A recovery route that returns
   admin without provider-level assurance recreates AUTH-01 under a new name.
   Privileged SQL is acceptable because it already implies full database control;
   an application endpoint is not.

Verify recovery **before** 4d.

**4c. Re-run 4a.** Expect PASS on *"a factor is enrolled"* and on *"password-only
session is aal1, not aal2"*.

**4d. Only then:** `ADMIN_MFA_POLICY = required`

**4e. Prove both directions manually** — a bearer token is not the app's cookie
session:

- password only → admin console **refused**
- TOTP completed → admin console **admitted**

---

## Step 5 — retire the legacy routes · MANUAL

`save-purchase`, `register-user`, `get-purchases` return 410 and have no
repository caller. After the deploy, watch production logs for
`[retired-route] blocked call to retired endpoint`.

- **Silent** → delete the three route files, `lib/auth/retired-route.js`,
  `LEGACY_SEED_ROUTES_ENABLED`, and `ADMIN_SEED_SECRET`.
- **Traffic** → identify the caller, move it to the narrowest `ServiceCapability`,
  then delete the switch anyway.

`LEGACY_SEED_ROUTES_ENABLED` is a discovery switch, not architecture. It must not
survive F0.

Note the ordering dependency: `ADMIN_SEED_SECRET` cannot be deleted here if Step
1a found it identical to `GUEST_SESSION_SECRET` and you are still inside the
cookie rotation window.

---

## Step 6 — re-run the E0 certification · SQL EDITOR

```sql
select * from public.e0_certify();
```

Expect **13 passed, 0 failed**.

This cannot be run over PostgREST — `e0_certify` returns `PGRST202` for
`service_role`, consistent with E0-D's `revoke ... from public` leaving it
operator-only. That is the desired posture for a certification function, but it
does mean the SQL editor is the only route.

---

## Step 7 — rotate the service role key · SUPABASE

The `service_role` key was pasted into an assistant transcript on 2026-08-22 to
run Step 3. It should be treated as disclosed and rotated.

Supabase Dashboard → Project Settings → API Keys → roll the secret key, then
update every consumer:

- Vercel `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_SECRET_KEY` if it holds the
  same value)
- `E2E_SUPABASE_SERVICE_ROLE_KEY`
- any worker or cron holding it

Rotation is not optional cleanup — that key bypasses every RLS policy E0 and E1
established, which is precisely why it was the credential able to run Step 3.

---

## Carried forward to F0 — not blocking E1

**1. Should `p_max_attempts` be caller-supplied at all?**

Only `service_role` can execute the RPC, so no ordinary client can influence it —
but a privileged caller could pass `p_max_attempts = 1000000` and silently
disable lockout for that challenge. A security invariant belongs to the authority
that enforces it, not to every caller. Decide: keep it explicit (auditable), or
move it inside the function / database configuration (unweakenable). The same
question applies to the 10-minute TTL, currently a caller-set `expires_at` with a
database default as backstop.

**2. `result = 'expired'` conflates four distinct terminal conditions.**

Observed directly in the T1 and T2 distributions — T1 returned
`{expired:47, invalid:2, locked:1}` and T2 returned `{expired:19, ok:1}`. The
function returns `expired` whenever the `SELECT ... FOR UPDATE` matches no row,
which covers: genuinely past `expires_at`; wrong principal; already consumed
successfully; already locked out.

Non-disclosure is the right call at the API boundary, so this is not a security
defect. But two consequences deserve a decision:

- `login-step2` maps `expired` → *"Code expired. Please log in again."* A user who
  double-submits a correct code sees a failure message while actually being
  logged in, and a locked-out user is told the wrong reason.
- `login_otp.used = true` is written identically for *burned by success* and
  *burned by lockout*, so the table cannot distinguish them after the fact. There
  is no forensic record of which challenges died to brute force.

Confirmed as an F0 identity/auth item: the client keeps receiving one generic
result, but internally `SUCCESS_CONSUMED`, `LOCKOUT_CONSUMED` and `EXPIRED` must
be distinguishable. Whether an OTP died because it was used or because someone
exhausted the challenge is exactly the thing an auth audit needs to reconstruct.
Consider an internal-only reason code, or a separate terminal column, logged
server-side and never returned to the caller.

**3. `findGuestBySyntheticEmail` is an O(n) scan of the entire user table.**

Found while sizing the rotation blast radius. Every guest identity resolution
calls `admin.auth.admin.listUsers({page, perPage: 1000})` in a loop and scans for
a matching synthetic email — up to 20 pages, 20,000 users. At the current 32
users it is one page and invisible. It degrades linearly and is on the checkout
path.

The synthetic email is a deterministic digest of `email + phone`, so this wants
to be an indexed lookup, not a scan. Not an E1 blocker — no security consequence,
current cost is negligible — but it belongs in F0's scalability pass, and it is
the kind of thing that is cheap now and expensive after launch.

**The larger question F0 must answer is not "how do we index this scan."** It is
whether a synthetic email address should be load-bearing identity at all.

Today a guest principal's canonical key is
`guest-<sha256(email:phone)>@guest.2mrrw.local`, stored in `auth.users.email`,
which means:

- identity is discovered by scanning a column that was never meant to be an index
- the identity key is derived from two mutable contact attributes, so a corrected
  phone number silently produces a *different principal* rather than the same one
- the real contact address lives in `user_metadata`, so the authoritative
  identifier and the deliverable address are in two different places with no
  referential guarantee between them

F0 should decide between indexing the existing derivation and giving guest
principals an explicit canonical identifier with an indexed mapping table. The
second is the direction consistent with everything E0/E1 established about
authority living in one place. Formally carried forward.

---

## E1 CLOSED when all of these are true

- [x] Migration applied (rev 3)
- [x] Signature STOP gate — 3/3, no surviving weak contract
- [x] Repository sweep — no caller depends on newest-by-user
- [x] `e1-otp-concurrency.mjs` — 11/11, T0 negative control included
- [x] Attacker-side wire proof — 4/4 with a valid positive control
- [ ] 2FA smoke test against the current deployment (Step 0.5)
- [ ] `GUEST_SESSION_SECRET` vs `ADMIN_SEED_SECRET` compared, rotation decided
- [ ] `GIFT_REMINDER_SIGNING_SECRET` + `COLLECTOR_CARD_HASH_SECRET` set
- [ ] **E1 code deployed to production**
- [ ] Production behaviour verified (Step 2)
- [ ] TOTP factor enrolled; recovery procedure verified
- [ ] `ADMIN_MFA_POLICY=required`; aal1 denied, aal2 admitted
- [ ] Legacy route disposition decided
- [ ] `e0_certify()` still 13/13
- [ ] Service role key rotated

Then, and only then: **F0 exhaustive coverage closure.**
