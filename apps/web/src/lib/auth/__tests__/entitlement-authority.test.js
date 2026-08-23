/**
 * E0 — Entitlement Authority Hardening: regression suite.
 *
 * Run: node --test apps/web/src/lib/auth/__tests__/entitlement-authority.test.js
 *
 *   INV-ENT-1  User-controlled profile/auth metadata can never grant admin authority.
 *   INV-ENT-2  Admin capability originates only from server-controlled state.
 *   INV-ENT-3  A revocation increment immediately invalidates all cached grants
 *              derived from an older entitlement generation.
 *   INV-ENT-4  No slug-level positive cache may outlive the authorization
 *              generation under which it was computed.
 *   INV-ENT-5  Stripe webhook delivery never depends on HTTP redirect following.
 *   INV-ENT-6  Catalog naming conventions cannot independently grant capability.
 *   INV-ENT-8  Redis failure may reduce performance but may not default
 *              authorization to allow.
 *
 * These are the tests that would have caught ENT-01, ENT-02, ENT-03, ENT-04 and
 * ENT-13 before they shipped.
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../..");           // apps/web/src
const APP = path.resolve(SRC, "..");                   // apps/web

const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");
const readApp = (rel) => readFileSync(path.join(APP, rel), "utf8");

/**
 * Strip comments so assertions test executable code, not prose. These files
 * deliberately NAME the forbidden sources in their docstrings to explain why they
 * are forbidden — matching that text would be a false positive.
 */
const codeOnly = (src) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-1 / INV-ENT-2 — admin authority sources
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-1/2: admin authority comes only from server-controlled state", () => {
  const constants = read("lib/auth/constants.js");
  const sessionUser = read("lib/auth/session-user.js");
  const entitlements = read("lib/commerce/entitlements.js");

  test("E1.1 isAdminUser does NOT accept a bare user.role === 'admin'", () => {
    // ENT-01/ENT-02 both landed here: `role` was fed from profiles.role (client
    // writable via RLS) and user_metadata.role (client writable via updateUser).
    const active = constants
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(
      !/user\.role\s*===\s*["']admin["']/.test(active),
      "isAdminUser must not treat user.role as an authority source"
    );
  });

  test("E1.2 isAdminUser accepts the server-resolved isAdmin flag", () => {
    assert.match(constants, /user\.isAdmin\s*===\s*true/);
  });

  test("E1.3 isAdminUser still honours app_metadata.role (service-role only)", () => {
    assert.match(constants, /app_metadata\?\.role\s*===\s*["']admin["']/);
  });

  test("E1.4 session-user NEVER reads user_metadata.role", () => {
    assert.ok(
      !/user_metadata\??\.\s*role/.test(codeOnly(sessionUser)),
      "user_metadata is writable via supabase.auth.updateUser() — ENT-02"
    );
  });

  test("E1.5 session-user no longer selects profiles.role", () => {
    const selects = sessionUser.match(/\.select\(([^)]*)\)/g) || [];
    for (const s of selects) {
      assert.ok(!/\brole\b/.test(s), `profiles.role must not feed authority: ${s}`);
    }
  });

  test("E1.6 session-user resolves admin through admin-authority", () => {
    assert.match(sessionUser, /isAdminPrincipal/);
    assert.match(sessionUser, /from\s+["']@\/lib\/auth\/admin-authority["']/);
  });

  test("E1.7 entitlement resolver no longer derives admin from profiles.role", () => {
    assert.ok(
      !/resolveAdminFromProfile/.test(entitlements),
      "resolveAdminFromProfile read profiles.role into isAdminUser — the ENT-01 sink"
    );
    assert.match(entitlements, /isAdminUserId/);
  });

  test("E1.8 admin-authority does not consult any user-writable source", () => {
    const mod = read("lib/auth/admin-authority.js");
    const active = mod
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    assert.ok(!/user_metadata/.test(active), "user_metadata is user-writable");
    assert.ok(!/profiles/.test(active), "profiles.role was client-writable via RLS");
    assert.match(active, /admin_principals/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-1 — schema level
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-1: schema prevents self-promotion", () => {
  const migration = readApp(
    "supabase/migrations/20260821000010_entitlement_authority_hardening.sql"
  );

  test("E2.1 admin_principals exists with RLS enabled", () => {
    assert.match(migration, /create table if not exists public\.admin_principals/);
    assert.match(migration, /alter table public\.admin_principals enable row level security/);
  });

  test("E2.2 admin_principals grants nothing to client roles", () => {
    assert.match(migration, /revoke all on public\.admin_principals from anon/);
    assert.match(migration, /revoke all on public\.admin_principals from authenticated/);
    // With RLS on and zero policies, every non-superuser role is denied.
    assert.ok(
      !/create policy[^;]*on public\.admin_principals/i.test(migration),
      "no policy may expose admin_principals to clients"
    );
  });

  test("E2.3 blanket UPDATE on profiles is revoked from authenticated", () => {
    assert.match(migration, /revoke update on public\.profiles from authenticated/);
  });

  test("E2.4 a guard trigger rejects client-originated role changes", () => {
    assert.match(migration, /profiles_guard_privileged_columns/);
    assert.match(migration, /new\.role is distinct from old\.role/);
    assert.match(migration, /service_role/);
    assert.match(migration, /before update on public\.profiles/);
  });

  test("E2.5 the update policy states an explicit WITH CHECK", () => {
    const policy = migration.match(
      /create policy "profiles_update_own"[\s\S]*?;/
    )?.[0];
    assert.ok(policy, "profiles_update_own policy must be redefined");
    assert.match(policy, /with check \(auth\.uid\(\) = id\)/);
  });

  test("E2.6 existing admins are backfilled so the operator is not locked out", () => {
    assert.match(migration, /insert into public\.admin_principals[\s\S]*?where p\.role = 'admin'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-3 / INV-ENT-4 / INV-ENT-8 — generation-based revocation
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-3/4/8: generation-based cache invalidation", () => {
  const cache = read("lib/server/entitlement-cache.js");

  test("E3.1 a generation counter exists and can be bumped", () => {
    assert.match(cache, /export async function getEntitlementGeneration/);
    assert.match(cache, /export async function bumpEntitlementGeneration/);
    // E0-C: the bump is an atomic INCR+EXPIRE script rather than two discrete
    // commands, so a crash between them cannot leave the counter without a TTL.
    assert.match(cache, /redis\.call\('INCR', KEYS\[1\]\)/);
    assert.match(cache, /`ent:gen:\$\{userId\}`/);
  });

  test("E3.2 tier invalidation bumps the generation, not just the tier key", () => {
    const fn = cache.match(
      /export async function invalidateEntitlementTierCache[\s\S]*?\n}/
    )?.[0];
    assert.ok(fn);
    assert.match(fn, /bumpEntitlementGeneration/,
      "ENT-03: deleting only ent:tier left every per-slug grant live");
  });

  test("E3.3 full invalidation bumps the generation regardless of named slugs", () => {
    const fn = cache.match(
      /export async function invalidateUserEntitlementCache[\s\S]*?\n}/
    )?.[0];
    assert.ok(fn);
    assert.match(fn, /bumpEntitlementGeneration/,
      "callers that pass no slugs must still invalidate everything");
  });

  test("E3.4 slug entries are written WITH a generation stamp", () => {
    const fn = cache.match(/export async function setCachedSlugResult[\s\S]*?\n}/)?.[0];
    assert.ok(fn);
    assert.match(fn, /getEntitlementGeneration/);
    assert.match(fn, /\$\{generation\}:/);
  });

  test("E3.5 slug GRANTS are generation-validated on read", () => {
    const fn = cache.match(/export async function getCachedSlugResult[\s\S]*?\n}/)?.[0];
    assert.ok(fn);
    assert.match(fn, /entryGen !== generation/);
  });

  test("E3.6 legacy un-stamped slug entries are treated as stale", () => {
    const fn = cache.match(/export async function getCachedSlugResult[\s\S]*?\n}/)?.[0];
    assert.match(fn, /if \(sep < 0\) return null;/,
      "entries written before E0 carry no generation and must not be honoured");
  });

  test("E3.7 tier entries are generation-stamped and validated", () => {
    const setFn = cache.match(/export async function setCachedTier[\s\S]*?\n}/)?.[0];
    const getFn = cache.match(/export async function getCachedTier[\s\S]*?\n}/)?.[0];
    assert.match(setFn, /_gen: generation/);
    assert.match(getFn, /stored\._gen !== generation/);
  });

  test("E3.8 INV-ENT-8 — unreachable Redis denies cache use rather than allowing", () => {
    const genFn = cache.match(/export async function getEntitlementGeneration[\s\S]*?\n}/)?.[0];
    assert.match(genFn, /if \(!redis\) return null;/);

    for (const name of ["getCachedSlugResult", "getCachedTier"]) {
      const fn = cache.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n}`))?.[0];
      assert.match(
        fn,
        /generation === null\) return null/,
        `${name} must treat an unresolvable generation as a cache miss, never as allow`
      );
    }
  });

  test("E3.9 denials may still be served from L1 (fail-closed direction)", () => {
    const fn = cache.match(/export async function getCachedSlugResult[\s\S]*?\n}/)?.[0];
    assert.match(fn, /l1\.result === false\) return false/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-5 — webhook delivery
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-5: webhook delivery never depends on redirects", () => {
  const routes = [
    "app/api/webhook/route.js",
    "app/api/stripe/webhook/route.js",
    "app/api/webhooks/stripe/route.js",
  ];

  for (const rel of routes) {
    test(`E4 ${rel} invokes the handler directly`, () => {
      const src = read(rel);
      assert.ok(
        !/NextResponse\.redirect/.test(src),
        "Stripe does not follow redirects; a 3xx is recorded as a failed delivery"
      );
      assert.match(src, /handleStripeWebhook\(req\)/);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-6 — naming conventions confer nothing
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-6: catalog naming cannot grant capability", () => {
  const entitlements = read("lib/commerce/entitlements.js");
  const migration = readApp(
    "supabase/migrations/20260821000010_entitlement_authority_hardening.sql"
  );

  test("E5.1 collector authority is resolved from the typed column", () => {
    const fn = entitlements.match(/async function ownsCollectorProduct[\s\S]*?\n}/)?.[0];
    assert.ok(fn, "ownsCollectorProduct must exist");
    assert.match(fn, /is_collector_product/);
  });

  test("E5.2 getCollectorAccessState no longer prefix-matches owned slugs directly", () => {
    const fn = entitlements.match(
      /export async function getCollectorAccessState[\s\S]*?\n}/
    )?.[0];
    assert.ok(
      !/\.some\(isCollectorAccessSlug\)/.test(fn),
      "slug prefixes must not be the authority path"
    );
    assert.match(fn, /ownsCollectorProduct/);
  });

  test("E5.3 with no admin client, collector access is denied not inferred", () => {
    const fn = entitlements.match(
      /export async function getCollectorAccessState[\s\S]*?\n}/
    )?.[0];
    assert.match(fn, /hasCollectorAccess: false/);
  });

  test("E5.4 the typed column is created, backfilled and made NOT NULL", () => {
    assert.match(migration, /add column if not exists is_collector_product boolean/);
    assert.match(migration, /set is_collector_product = true/);
    assert.match(migration, /alter column is_collector_product set not null/);
  });
});
