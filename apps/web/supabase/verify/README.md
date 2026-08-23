# E0 verification — run order

Two of these are **SQL** (Supabase SQL editor). One is a **terminal** command.
Mixing them up produces confusing errors, so the target is stated on every step.

---

## Step 0 — preflight  ·  SQL EDITOR

```
e0-step0-preflight.sql
```

A single read-only `SELECT`. Returns rows.

**Every migration row must read `PRESENT`.** If any reads `MISSING`, apply that
migration before continuing — the certification script cannot run against a
schema that lacks these objects.

---

## Step 1 — apply migrations  ·  SQL EDITOR

In order. All three are idempotent and safe to re-run.

```
migrations/20260821000010_entitlement_authority_hardening.sql   (E0-A)
migrations/20260822000010_e0b_final_authority_hardening.sql     (E0-B)
migrations/20260822000020_e0c_atomic_authority_closure.sql      (E0-C)
```

Re-run Step 0 afterwards and confirm everything now reads `PRESENT`.

---

## Step 2 — seed admin  ·  SQL EDITOR (or env var)

`ADMIN_EMAIL` no longer grants anything at runtime (INV-ENT-9). Pick one:

```sql
select public.bootstrap_admin_by_email('you@example.com');
```

or set `ADMIN_USER_ID` in the deployment environment to your Supabase user UUID.

The migrations also backfill from `profiles.role = 'admin'`, so an existing admin
should already be present. Step 3 verifies you are not locked out.

---

## Step 3 — SQL certification  ·  SQL EDITOR

```
e0-live-certification.sql
```

Paste the whole file. Returns a `gate | status | detail` table; the last row is
`== VERDICT ==`.

**What this proves:** the guard trigger across four execution contexts, catalog
grants, RLS policy shape, lockout safety, ownership-state consistency, and the
privilege-table write-policy sweep.

**What it does NOT prove:** that a real browser session is blocked. This script
runs as a privileged role, which bypasses RLS and column privileges entirely. A
green verdict here is necessary but not sufficient — hence Step 4.

---

## Step 4 — end-to-end escalation check  ·  TERMINAL, NOT SQL

> This is a Node script. Do **not** paste it into the SQL editor — that produces
> `ERROR: 42601: syntax error at or near "SUPABASE_URL"`.

Use a **throwaway non-admin account**. Staging first if you have one.

**macOS / Linux / Git Bash:**

```bash
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_ANON_KEY=<PUBLIC anon key> \
TEST_EMAIL=throwaway@example.com \
TEST_PASSWORD=... \
node e0-http-check.mjs
```

**PowerShell:**

```powershell
$env:SUPABASE_URL      = "https://xxxx.supabase.co"
$env:SUPABASE_ANON_KEY = "<PUBLIC anon key>"
$env:TEST_EMAIL        = "throwaway@example.com"
$env:TEST_PASSWORD     = "..."
node e0-http-check.mjs
```

Use the **public anon key**, never the service-role key — the script refuses the
service key, because running it with elevated credentials would produce a
meaningless pass. It also refuses an account that is already admin.

It attempts both escalations for real and restores everything it touched.

---

## Closure

E0 is closed only when **Step 3 verdict = PASS** and **Step 4 verdict = PASS**.

Until then, Slice 1D does not begin.
