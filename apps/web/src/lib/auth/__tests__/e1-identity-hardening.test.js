/**
 * E1 — Identity & Secret Hardening: regression suite.
 *
 *   INV-ADMIN-1  A guest identity can never be administrative.
 *   INV-ID-1  Email + phone is identification, never authentication.
 *   INV-SEC-2  One secret, one trust domain. No signing key doubles as a
 *               bearer credential.
 *   INV-ADMIN-3  Privileged routes authorise by actor session or a dedicated
 *               service credential — never a shared secret, never client-side.
 *   AUTH-02     OTP consumption is atomic and rate limited.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isAdminUser } from "../constants.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../..");
const APP = path.resolve(SRC, "..");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");
const readApp = (rel) => readFileSync(path.join(APP, rel), "utf8");

const codeOnly = (src) =>
  src.split("\n").filter((l) => {
    const t = l.trim();
    return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

// ─────────────────────────────────────────────────────────────────────────────
// INV-ADMIN-1 — guest can never be admin  (BEHAVIOURAL)
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ADMIN-1: a guest identity is never administrative", () => {
  const ADMIN_ID = process.env.ADMIN_USER_ID || "";

  test("F1.1 a guest carrying the admin user id is rejected", () => {
    // The forged-cookie escalation: getGuestUser() resolves whatever id the
    // signed cookie names, and the ADMIN_USER_ID branch used to match on id alone.
    assert.equal(isAdminUser({ id: ADMIN_ID || "any-id", isGuest: true }), false);
  });

  test("F1.2 a guest with isAdmin:true is still rejected", () => {
    assert.equal(isAdminUser({ id: "x", isGuest: true, isAdmin: true }), false);
  });

  test("F1.3 a guest with an admin app_metadata claim is still rejected", () => {
    assert.equal(
      isAdminUser({ id: "x", isGuest: true, app_metadata: { role: "admin" } }),
      false
    );
  });

  test("F1.4 a real session with isAdmin:true is still accepted", () => {
    assert.equal(isAdminUser({ id: "x", isGuest: false, isAdmin: true }), true);
  });

  test("F1.5 a real session with an app_metadata claim is still accepted", () => {
    assert.equal(
      isAdminUser({ id: "x", isGuest: false, app_metadata: { role: "admin" } }),
      true
    );
  });

  test("F1.6 the guard precedes every other branch in the source", () => {
    const src = codeOnly(read("lib/auth/constants.js"));
    const guard = src.indexOf("user.isGuest === true");
    const idBranch = src.indexOf("ADMIN_USER_ID && user.id");
    const metaBranch = src.indexOf("app_metadata");
    assert.ok(guard > -1, "isGuest guard must exist");
    assert.ok(guard < idBranch && guard < metaBranch,
      "the guest rejection must run before any accepting branch");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ID-1 — email + phone is not authentication
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ID-1: contact details cannot mint an identity", () => {
  test("F2.1 the guest endpoint is read/clear only", () => {
    const route = codeOnly(read("app/api/guest/session/route.js"));
    assert.ok(!/export async function POST/.test(route));
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function DELETE/);
  });

  test("F2.2 guest identity creation helpers are absent", () => {
    const gs = codeOnly(read("lib/guest-session.js"));
    assert.ok(!/createOrRetrieveGuest|findExistingGuest|syntheticAuthEmail/.test(gs));
  });

  test("F2.3 the caller-less legacy gift redemption route is deleted", () => {
    assert.equal(existsSync(path.join(SRC, "app/api/gifts/redeem/route.js")), false);
  });

  test("F2.4 no route creates a new guest cookie", () => {
    const routes = allRoutes();
    const minters = routes
      .filter((p) => /withGuestCookie\s*\(/.test(codeOnly(readFileSync(p, "utf8"))))
      .map((p) => path.relative(SRC, p).replace(/\\/g, "/"));
    // account/state only refreshes an existing cookie; it never creates identity.
    const expected = ["app/api/account/state/route.js"];
    assert.deepEqual(minters.sort(), expected.sort(),
      "a new cookie-minting route appeared — it must obey INV-ID-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-SEC-2 — one secret, one trust domain
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-SEC-2: signing domains are separated", () => {
  test("F3.1 guest cookies no longer fall back to ADMIN_SEED_SECRET", () => {
    const src = codeOnly(read("lib/guest-session.js"));
    // Match the env READ specifically — the module names the old variable in an
    // error message, which is documentation rather than a fallback.
    assert.ok(!/process.env.ADMIN_SEED_SECRET/.test(src),
      "a key that signs session cookies must not be an admin bearer token");
    assert.match(src, /process.env.GUEST_SESSION_SECRET/);
  });

  test("F3.2 gift reminder links no longer fall back to ADMIN_SEED_SECRET", () => {
    const src = codeOnly(read("lib/gifts/reminder-link.js"));
    assert.ok(!/process.env.ADMIN_SEED_SECRET/.test(src));
  });

  test("F3.3 collector IP hashing no longer falls back to ADMIN_SEED_SECRET", () => {
    const src = codeOnly(read("lib/collector-cards.js"));
    assert.ok(!/process.env.ADMIN_SEED_SECRET/.test(src));
  });

  test("F3.4 guest cookie signing supports dual-key rotation", () => {
    const src = read("lib/guest-session.js");
    assert.match(src, /GUEST_SESSION_SECRET_PREVIOUS/);
    assert.match(src, /function verifyAgainst/);
  });

  test("F3.5 cookie verification cannot throw on a length mismatch", () => {
    const fn = read("lib/guest-session.js").match(/function verifyAgainst[\s\S]*?\n}/)?.[0];
    assert.ok(fn);
    assert.match(fn, /a\.length !== b\.length/,
      "timingSafeEqual throws RangeError on unequal lengths — check first");
  });

  test("F3.6 signing fails closed with no secret configured", () => {
    const fn = read("lib/guest-session.js").match(/function signGuestId[\s\S]*?\n}/)?.[0];
    assert.match(fn, /if \(!key\)/);
    assert.match(fn, /throw new Error/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ADMIN-3 — privileged routes and the client boundary
// ─────────────────────────────────────────────────────────────────────────────

function allRoutes() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.js") out.push(p);
    }
  };
  walk(path.join(SRC, "app/api"));
  return out;
}

describe("INV-ADMIN-3: privileged routes authorise by actor or service credential", () => {
  test("F4.1 no API route reads ADMIN_SEED_SECRET directly", () => {
    const offenders = allRoutes()
      .filter((p) => /ADMIN_SEED_SECRET/.test(codeOnly(readFileSync(p, "utf8"))))
      .map((p) => path.relative(SRC, p));
    assert.deepEqual(offenders, [],
      `routes still reading the shared secret: ${offenders.join(", ")}`);
  });

  test("F4.2 no CLIENT file handles the admin secret", () => {
    const clientDirs = ["app/admin", "components", "context", "hooks"];
    const offenders = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) {
          const src = codeOnly(readFileSync(p, "utf8"));
          if (/ADMIN_SEED_SECRET|x-seed-secret/.test(src)) offenders.push(path.relative(SRC, p));
        }
      }
    };
    for (const d of clientDirs) walk(path.join(SRC, d));
    assert.deepEqual(offenders, [],
      `a server secret is handled client-side: ${offenders.join(", ")}`);
  });

  test("F4.3 no window.prompt collects a secret anywhere", () => {
    const offenders = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          if (/window\.prompt\([^)]*(?:SECRET|secret|TOKEN|token|password)/.test(src)) {
            offenders.push(path.relative(SRC, p));
          }
        }
      }
    };
    walk(path.join(SRC, "app"));
    walk(path.join(SRC, "components"));
    assert.deepEqual(offenders, [], `prompt-collected secret: ${offenders.join(", ")}`);
  });

  test("F4.4 the guard compares in constant time and tolerates length mismatch", () => {
    const src = read("lib/auth/admin-api-guard.js");
    assert.match(src, /timingSafeEqual/);
    assert.match(src, /x\.length !== y\.length/);
  });

  test("F4.5 there is NO universal admin bearer secret", () => {
    const src = codeOnly(read("lib/auth/admin-api-guard.js"));
    // INV-ADMIN-3: no reusable master credential. Every machine credential is
    // bound to one named capability, so compromise of one integration is not
    // platform compromise.
    assert.ok(!/ADMIN_SEED_SECRET|ADMIN_API_SECRET\b/.test(src),
      "a reusable admin bearer secret would be a parallel canonical authority");
    assert.match(src, /export const ServiceCapability/);
    assert.match(src, /requireServiceCapability\(req, capability\)/);
  });

  test("F4.6 an unconfigured capability grants nothing (fails closed)", () => {
    const fn = read("lib/auth/admin-api-guard.js")
      .match(/export function requireServiceCapability[\s\S]*?\n}/)?.[0];
    assert.ok(fn);
    assert.match(fn, /capability_not_configured/,
      "an unset capability must never be satisfied by another secret that is set");
  });

  test("F4.7 each rewired route names its own capability", () => {
    const expected = {
      "app/api/admin/seed-products/route.js": "PRODUCT_SEED",
      "app/api/admin/fulfill-recovery/route.js": "FULFILL_RECOVERY",
      "app/api/admin/sync/catalog/route.js": "CATALOG_SYNC",
      "app/api/admin/sync/drop-notification/route.js": "DROP_NOTIFICATION",
      "app/api/admin/catalog/r2-ingest/route.js": "CATALOG_INGEST",
      "app/api/admin/catalog/revalidate/route.js": "CATALOG_REVALIDATE",
      "app/api/admin/diagnostics/entitlements-parity/route.js": "DIAGNOSTICS_READ",
    };
    for (const [rel, cap] of Object.entries(expected)) {
      assert.match(codeOnly(read(rel)), new RegExp(`ServiceCapability\\.${cap}\\b`),
        `${rel} must declare capability ${cap}`);
    }
  });

  test("F4.8 admin/gifts is human-administrator only", () => {
    const src = codeOnly(read("app/api/admin/gifts/route.js"));
    assert.match(src, /requireAdminActor\(\)/);
    assert.ok(!/ServiceCapability/.test(src),
      "an interactive admin action needs no machine credential");
  });

  test("F4.9 the three caller-less routes are RETIRED, not re-blessed as admin", () => {
    for (const rel of [
      "app/api/save-purchase/route.js",
      "app/api/register-user/route.js",
      "app/api/get-purchases/route.js",
    ]) {
      const src = codeOnly(read(rel));
      assert.match(src, /retiredRouteGuard\(/,
        `${rel} has no caller and must not be granted a new admin lease`);
      assert.ok(!/requireAdminActor|requireAdminOrCapability/.test(src));
    }
  });

  test("F4.10 retirement defaults to blocked", () => {
    const src = read("lib/auth/retired-route.js");
    assert.match(src, /LEGACY_SEED_ROUTES_ENABLED === "1"/);
    assert.match(src, /status: 410/);
    // The secure state must need no configuration.
    assert.match(src, /const enabled = process\.env\.LEGACY_SEED_ROUTES_ENABLED === "1";/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-AUTH-1 / INV-AUTH-2 — MFA assurance comes from the provider
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-AUTH-1/2: custom MFA is durable, session-bound, and fail-closed", () => {
  const src = read("lib/auth/mfa-authority.js");
  test("F6.1 opaque authority is hashed and server-backed", () => {
    assert.match(src, /randomBytes\(32\)/);
    assert.match(src, /sha256/);
    assert.match(src, /issue_2mrrw_mfa_authority/);
  });
  test("F6.2 authority binds immutable user and Supabase session", () => {
    assert.match(src, /session_id/);
    assert.match(src, /session\.user\?\.id !== userId/);
    assert.match(src, /p_auth_session_id: sessionId/);
  });
  test("F6.3 missing production policy fails closed", () => {
    assert.match(src, /resolveHumanAdminMfaPolicy/);
    assert.match(read("lib/auth/mfa-policy.js"), /custom_mfa_configuration_missing/);
  });
  test("F6.4 canonical admin boundary requires custom authority, not AAL", () => {
    const guard = read("lib/auth/admin-api-guard.js");
    assert.match(guard, /verifyMfaAuthority/);
    assert.doesNotMatch(guard, /requireMfaAssurance|getAuthenticatorAssuranceLevel/);
  });
  test("F6.5 only successful login-step2 commits authority", () => {
    const step2 = read("app/api/auth/login-step2/route.js");
    const issue = step2.lastIndexOf("issueMfaAuthority");
    const ok = step2.indexOf('result !== "ok"');
    assert.ok(issue > ok);
    assert.match(step2, /mfaVerified: true/);
  });
  test("F6.6 sign-out revokes server authority before Supabase sign-out", () => {
    const context = read("context/AuthContext.js");
    assert.ok(context.indexOf('/api/auth/mfa-session') < context.indexOf('authSignOut()'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ID-2 — possession proof before session issuance
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ID-2: only registered identities are admitted", () => {
  test("F7.1 no guest possession-proof surface remains", () => {
    assert.equal(existsSync(path.join(SRC, "lib/auth/guest-proof.js")), false);
    const route = codeOnly(read("app/api/guest/session/route.js"));
    assert.ok(!/PROOF_REQUIRED|issueGuestProofChallenge|verifyGuestProofChallenge/.test(route));
  });

  test("F7.2 a principal assurance vocabulary exists", () => {
    const p = read("lib/auth/principal.js");
    for (const k of ["GUEST_UNVERIFIED", "GUEST_VERIFIED", "REGISTERED_VERIFIED", "MFA_VERIFIED"]) {
      assert.match(p, new RegExp(k));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-02 — atomic OTP + rate limit
// ─────────────────────────────────────────────────────────────────────────────

describe("AUTH-02: OTP consumption is atomic and rate limited", () => {
  const step2 = read("app/api/auth/login-step2/route.js");
  const mig = readApp("supabase/migrations/20260822000040_e1_auth_hardening.sql");

  test("F5.1 login-step2 now rate limits", () => {
    assert.match(step2, /checkRateLimit/);
    assert.match(step2, /routeKey: "auth\.login-step2"/);
  });

  test("F5.2 the JS read-modify-write is gone", () => {
    assert.ok(!/otp\.attempts \+ 1/.test(step2),
      "attempts must be incremented by the database, not the caller");
    assert.ok(!/\.update\(\{ attempts:/.test(step2));
  });

  test("F5.3 verification goes through the atomic function", () => {
    assert.match(step2, /rpc\("consume_login_otp"/);
  });

  test("F5.4 the function increments in place and locks the row", () => {
    assert.match(mig, /set attempts = attempts \+ 1/);
    assert.match(mig, /for update/);
  });

  test("F5.5 the function burns the code on success and on lockout", () => {
    const fn = mig.match(/create or replace function public\.consume_login_otp[\s\S]*?\$\$;/)?.[0];
    assert.ok(fn);
    assert.equal((fn.match(/set used = true/g) || []).length, 2,
      "used=true must be set both when locking out and on a correct code");
  });

  test("F5.6 login_otp is now under source control with RLS and no policies", () => {
    assert.match(mig, /create table if not exists public\.login_otp/);
    assert.match(mig, /alter table public\.login_otp enable row level security/);
    assert.ok(!/create policy[^;]*on public\.login_otp/i.test(mig));
  });

  test("F5.8 consumption binds to the exact challenge id", () => {
    assert.match(mig, /where o\.id = p_challenge_id/);
    assert.match(mig, /and o\.user_id = p_user_id/,
      "the user predicate must remain so one principal cannot consume another's challenge");
  });

  test("F5.8b p_challenge_id is REQUIRED — no nullable fallback survives", () => {
    // Once the stronger canonical identity exists, no alternate path to a weaker
    // one may remain. A nullable parameter with an `else newest-row-for-user`
    // branch is the same category of defect as a fallback secret.
    assert.ok(!/p_challenge_id uuid default null/.test(mig),
      "p_challenge_id must not have a DEFAULT — omitting it must be a hard error");
    assert.match(mig, /p_challenge_id uuid\s*\n\)/,
      "p_challenge_id must be declared without a default, last in the signature");
  });

  test("F5.8c the newest-row-for-user branch is gone entirely", () => {
    const fn = mig.match(/create or replace function public\.consume_login_otp[\s\S]*?\n\$\$;/)?.[0];
    assert.ok(fn, "function body not found");
    assert.ok(!/order by o\.created_at desc/.test(fn),
      "the weaker newest-live-row selection must not exist in the function at all");
    assert.ok(!/limit 1/.test(fn),
      "an unbounded newest-row lock implies the weak identity model");
    assert.equal((fn.match(/for update/g) || []).length, 1,
      "exactly one row-lock site — a second implies a second selection strategy");
    assert.match(fn, /p_challenge_id is null[\s\S]*?raise exception/,
      "an explicit NULL must raise, not silently widen the match");
  });

  test("F5.8d every production caller supplies an explicit challenge id", () => {
    for (const rel of ["app/api/auth/login-step2/route.js"]) {
      const src = codeOnly(read(rel));
      assert.match(src, /p_challenge_id:\s*[A-Za-z_][A-Za-z0-9_]*\s*,/,
        `${rel} must pass a bound identifier`);
      assert.ok(!/p_challenge_id:\s*(null|undefined|[A-Za-z_.]+\s*\?\?\s*null)/.test(src),
        `${rel} must not pass null or a null-coalesced value`);
    }
  });

  test("F5.8e login-step2 rejects a cookie with no challenge id", () => {
    // Pre-amendment cookies carry none. With the fallback removed they must be
    // refused rather than accepted under weaker matching. _2fa_pending has a
    // 600s maxAge, so the transition window is ten minutes.
    assert.match(step2, /if \(!challenge_id\) \{/);
    const block = step2.slice(step2.indexOf("if (!challenge_id) {"));
    assert.match(block.slice(0, 400), /status: 401/);
  });

  test("F5.9 the unsafe 3-argument overload is dropped", () => {
    // PostgreSQL overloads on parameter list — creating the 4-arg version without
    // dropping the 3-arg one would leave the newest-row-for-user variant callable.
    assert.match(mig, /drop function if exists public\.consume_login_otp\(uuid, text, integer\);/);
  });

  test("F5.10 the live login call site passes a challenge id", () => {
    assert.match(step2, /p_challenge_id: challenge_id,/);
    assert.match(read("app/api/auth/login-step1/route.js"), /challenge_id:\s*otpRow\.id/,
      "login-step1 must record the challenge id it issued");
  });

  test("F5.11 the function revokes from PUBLIC, not just the named roles", () => {
    assert.match(mig, /revoke all on function public\.consume_login_otp\(uuid, text, integer, uuid\) from public/);
    assert.match(mig, /grant  execute on function public\.consume_login_otp\(uuid, text, integer, uuid\) to service_role/);
  });
});
