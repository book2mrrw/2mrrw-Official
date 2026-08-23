/**
 * E0-B — Final Authority Hardening: regression suite.
 *
 * Run: node --test apps/web/src/lib/auth/__tests__/e0b-final-authority.test.js
 *
 *   INV-ENT-7   capabilityVersion changes iff effective authorization changes.
 *   INV-ENT-9   Admin authority binds only to immutable principal identity.
 *   INV-ENT-10  Ownership source of truth is an explicit state.
 *   INV-ENT-11  Admin revocation takes effect immediately across all instances.
 *
 * The capability and ownership tests are BEHAVIOURAL — they execute the real
 * functions. The SQL-context tests are structural (the executable three-context
 * proof runs against the live database via the harness in the migration).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCapabilityDocument,
  capabilityFingerprint,
  canonicalize,
  sameCapabilities,
} from "../capability-document.js";
import {
  OwnershipAuthorityState,
  resolveOwnedSlugs,
} from "../../commerce/ownership-authority.js";

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
// INV-ENT-9 — admin authority binds to immutable identity
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-9: admin authority never binds to a mutable attribute", () => {
  test("B1.1 constants.js no longer matches on email for authority", () => {
    const active = codeOnly(read("lib/auth/constants.js"));
    // The display-hint export may still read the env var, but no comparison
    // against a user's email may occur.
    assert.ok(
      !/user\.email|authEmail/.test(active),
      "isAdminUser must not compare any email"
    );
  });

  test("B1.2 admin-authority.js does not consult ADMIN_EMAIL", () => {
    const active = codeOnly(read("lib/auth/admin-authority.js"));
    assert.ok(!/ADMIN_EMAIL/.test(active));
    assert.ok(!/\.email/.test(active), "no email comparison anywhere in the resolver");
  });

  test("B1.3 hasTrustedAdminClaim accepts only id and app_metadata", () => {
    const fn = read("lib/auth/admin-authority.js")
      .match(/export function hasTrustedAdminClaim[\s\S]*?\n}/)?.[0];
    assert.ok(fn);
    assert.match(fn, /ADMIN_USER_ID && user\.id === ADMIN_USER_ID/);
    assert.match(fn, /app_metadata\?\.role === "admin"/);
    assert.ok(!/email/i.test(fn));
  });

  test("B1.4 no server route gates admin on an email comparison", () => {
    for (const rel of [
      "app/api/admin/visual-assets/route.js",
      "app/api/media/visual-assets/[slug]/route.js",
    ]) {
      const active = codeOnly(read(rel));
      assert.ok(
        !/=== *ADMIN_EMAIL|!== *ADMIN_EMAIL/.test(active),
        `${rel} must not compare email for authority`
      );
      assert.match(active, /isAdminUser/, `${rel} must use the single admin path`);
    }
  });

  test("B1.5 those routes no longer trust getSession() for identity", () => {
    for (const rel of [
      "app/api/admin/visual-assets/route.js",
      "app/api/media/visual-assets/[slug]/route.js",
    ]) {
      const active = codeOnly(read(rel));
      assert.ok(
        !/auth\.getSession\(\)/.test(active),
        `${rel} must resolve identity via getFanSessionUser() → getUser()`
      );
    }
  });

  test("B1.6 an email-only bootstrap exists as an operator SQL path", () => {
    const m = readApp("supabase/migrations/20260822000010_e0b_final_authority_hardening.sql");
    assert.match(m, /bootstrap_admin_by_email/);
    assert.match(m, /revoke all on function public\.bootstrap_admin_by_email\(text\) from authenticated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-11 — immediate admin revocation
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-11: admin revocation is immediate", () => {
  const mod = read("lib/auth/admin-authority.js");

  test("B2.1 cached admin decisions are generation-stamped", () => {
    assert.match(mod, /function readCache\(userId, generation\)/);
    assert.match(mod, /hit\.generation !== generation/);
  });

  test("B2.2 the cache is not consulted when the generation is unknown", () => {
    const fn = mod.match(/export async function isAdminPrincipal[\s\S]*?\n}/)?.[0];
    assert.match(fn, /if \(generation !== null\) \{[\s\S]*?readCache/);
  });

  test("B2.3 revoking admin bumps the generation", () => {
    const fn = mod.match(/export async function revokeAdminPrincipal[\s\S]*?\n}/)?.[0];
    assert.match(fn, /bumpEntitlementGeneration/);
  });

  test("B2.4 granting admin bumps the generation", () => {
    const fn = mod.match(/export async function grantAdminPrincipal[\s\S]*?\n}/)?.[0];
    assert.match(fn, /bumpEntitlementGeneration/);
  });

  test("B2.5 admin shares the entitlement generation (one capability substrate)", () => {
    assert.match(mod, /from "@\/lib\/server\/entitlement-cache"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-7 — capability document / fingerprint / version  (BEHAVIOURAL)
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-7: capabilityVersion moves iff rights move", () => {
  const base = {
    isAdmin: false, isSubscriber: true, isCollector: false,
    vaultTier: "inner_circle", playbackPolicy: "FULL_CATALOG",
    ownedSlugs: ["b-track", "a-track"],
  };

  test("B3.1 identical rights → identical fingerprint", () => {
    assert.equal(
      capabilityFingerprint(buildCapabilityDocument(base)),
      capabilityFingerprint(buildCapabilityDocument({ ...base }))
    );
  });

  test("B3.2 ownedSlugs order does not affect the fingerprint", () => {
    const a = buildCapabilityDocument({ ...base, ownedSlugs: ["a-track", "b-track"] });
    const b = buildCapabilityDocument({ ...base, ownedSlugs: ["b-track", "a-track"] });
    assert.ok(sameCapabilities(a, b));
  });

  test("B3.3 duplicate slugs do not affect the fingerprint", () => {
    const a = buildCapabilityDocument({ ...base, ownedSlugs: ["a", "b"] });
    const b = buildCapabilityDocument({ ...base, ownedSlugs: ["a", "b", "a", "b"] });
    assert.ok(sameCapabilities(a, b));
  });

  test("B3.4 a rights-neutral rewrite produces NO fingerprint change", () => {
    // Simulates Stripe re-sending subscription.updated on a billing cycle:
    // timestamps and ids move, rights do not. Those fields are not inputs at all,
    // which is precisely the guarantee.
    const before = buildCapabilityDocument(base);
    const after = buildCapabilityDocument({
      ...base,
      // deliberately passing extra keys that must be ignored
      updatedAt: "2026-08-22T00:00:00Z",
      stripeSubscriptionId: "sub_XYZ",
      membershipStatus: "active",
      sessionId: "sess_2",
    });
    assert.ok(sameCapabilities(before, after),
      "only declared rights fields may influence the fingerprint");
  });

  test("B3.5 gaining admin DOES change the fingerprint", () => {
    assert.ok(!sameCapabilities(
      buildCapabilityDocument(base),
      buildCapabilityDocument({ ...base, isAdmin: true })
    ));
  });

  test("B3.6 losing subscriber DOES change the fingerprint", () => {
    assert.ok(!sameCapabilities(
      buildCapabilityDocument(base),
      buildCapabilityDocument({ ...base, isSubscriber: false })
    ));
  });

  test("B3.7 acquiring a slug DOES change the fingerprint", () => {
    assert.ok(!sameCapabilities(
      buildCapabilityDocument(base),
      buildCapabilityDocument({ ...base, ownedSlugs: [...base.ownedSlugs, "c-track"] })
    ));
  });

  test("B3.8 vault tier and playback policy are rights-bearing", () => {
    assert.ok(!sameCapabilities(
      buildCapabilityDocument(base),
      buildCapabilityDocument({ ...base, vaultTier: "vault_pass" })
    ));
    assert.ok(!sameCapabilities(
      buildCapabilityDocument(base),
      buildCapabilityDocument({ ...base, playbackPolicy: "UNRESTRICTED" })
    ));
  });

  test("B3.9 canonicalize is key-order independent", () => {
    assert.equal(
      canonicalize({ b: 1, a: [3, 2] }),
      canonicalize({ a: [3, 2], b: 1 })
    );
  });

  test("B3.10 the document is frozen and carries a schema version", () => {
    const doc = buildCapabilityDocument(base);
    assert.ok(Object.isFrozen(doc));
    assert.equal(typeof doc.schema, "number");
    assert.throws(() => { doc.isAdmin = true; }, TypeError);
  });

  test("B3.11 fingerprint is a stable sha256 hex digest", () => {
    assert.match(capabilityFingerprint(buildCapabilityDocument(base)), /^[0-9a-f]{64}$/);
  });

  test("B3.12 account state emits document, fingerprint and version", () => {
    const route = read("app/api/account/state/route.js");
    assert.match(route, /buildCapabilityDocument/);
    assert.match(route, /resolveCapabilityVersion/);
    assert.match(route, /capabilityFingerprint,/);
    assert.match(route, /capabilityVersion,/);
  });

  test("B3.13 version only advances on a fingerprint delta", () => {
    const src = read("lib/auth/capability-version.js");
    // E0-C: the compare and the advance moved INSIDE a Lua script so they are one
    // indivisible operation (INV-ENT-12). The equality short-circuit now lives in
    // the script rather than in JS.
    assert.match(src, /if stored == ARGV\[1\] then/);
    assert.match(src, /redis\.call\('INCR', KEYS\[2\]\)/);
    assert.ok(!/await redis\.incr\(/.test(src),
      "a discrete INCR outside the script would reintroduce the race");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-10 — explicit ownership authority state  (BEHAVIOURAL)
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-10: ownership authority is explicit", () => {
  // E0-C: ENTITLEMENTS_CANONICAL is refused unless parity is attested at zero
  // (INV-ENT-14), so this stub supplies a satisfied attestation. Tests for the
  // refusal path itself live in the E0-C suite (C4.1–C4.4).
  const admin = {
    from: () => ({
      select: () => ({
        limit: () => ({
          maybeSingle: async () => ({
            data: {
              state: "DUAL_VERIFY",
              parity_verified_at: "2026-08-22T00:00:00Z",
              parity_library_only_count: 0,
            },
            error: null,
          }),
        }),
      }),
    }),
  };

  const withState = async (state, sources) => {
    const prev = process.env.OWNERSHIP_AUTHORITY_STATE;
    process.env.OWNERSHIP_AUTHORITY_STATE = state;
    try {
      return await resolveOwnedSlugs(admin, "u1", sources);
    } finally {
      if (prev === undefined) delete process.env.OWNERSHIP_AUTHORITY_STATE;
      else process.env.OWNERSHIP_AUTHORITY_STATE = prev;
    }
  };

  test("B4.1 DUAL_VERIFY unions both sources — the ENT-06 fix", () => {
    return withState(OwnershipAuthorityState.DUAL_VERIFY, {
      fromEntitlements: [],            // table exists but user not backfilled
      fromLibrary: ["owned-album"],    // real legacy ownership
    }).then(({ slugs }) => {
      assert.ok(slugs.has("owned-album"),
        "an unbackfilled entitlements table must not erase real ownership");
    });
  });

  test("B4.2 DUAL_VERIFY reports divergence", async () => {
    const { divergence } = await withState(OwnershipAuthorityState.DUAL_VERIFY, {
      fromEntitlements: ["only-ent"],
      fromLibrary: ["only-lib"],
    });
    assert.deepEqual(divergence.libraryOnly, ["only-lib"]);
    assert.deepEqual(divergence.entitlementsOnly, ["only-ent"]);
  });

  test("B4.3 DUAL_VERIFY reports no divergence when sources agree", async () => {
    const { divergence } = await withState(OwnershipAuthorityState.DUAL_VERIFY, {
      fromEntitlements: ["x"], fromLibrary: ["x"],
    });
    assert.equal(divergence, null);
  });

  test("B4.4 LEGACY_LIBRARY ignores entitlements", async () => {
    const { slugs } = await withState(OwnershipAuthorityState.LEGACY_LIBRARY, {
      fromEntitlements: ["ent-only"], fromLibrary: ["lib-only"],
    });
    assert.ok(slugs.has("lib-only"));
    assert.ok(!slugs.has("ent-only"));
  });

  test("B4.5 ENTITLEMENTS_CANONICAL ignores library_items", async () => {
    const { slugs } = await withState(OwnershipAuthorityState.ENTITLEMENTS_CANONICAL, {
      fromEntitlements: ["ent-only"], fromLibrary: ["lib-only"],
    });
    assert.ok(slugs.has("ent-only"));
    assert.ok(!slugs.has("lib-only"));
  });

  test("B4.6 a MISSING entitlements table can never be canonical", async () => {
    const { slugs, state } = await withState(OwnershipAuthorityState.ENTITLEMENTS_CANONICAL, {
      fromEntitlements: null,          // 42P01 — table absent
      fromLibrary: ["lib-only"],
    });
    assert.equal(state, OwnershipAuthorityState.LEGACY_LIBRARY);
    assert.ok(slugs.has("lib-only"),
      "configuring CANONICAL against a nonexistent table must not deny everyone");
  });

  test("B4.7 getOwnedSlugs routes through the authority resolver", () => {
    const src = read("lib/commerce/entitlements.js");
    const fn = src.match(/export async function getOwnedSlugs[\s\S]*?\n}/)?.[0];
    assert.match(fn, /resolveOwnedSlugs/);
    assert.ok(
      !/if \(fromEntitlements !== null\)\s*\{?\s*return new Set/.test(fn),
      "the implicit 'table exists therefore authoritative' branch must be gone"
    );
  });

  test("B4.8 the state table is server-only and defaults to DUAL_VERIFY", () => {
    const m = readApp("supabase/migrations/20260822000010_e0b_final_authority_hardening.sql");
    assert.match(m, /create table if not exists public\.ownership_authority_state/);
    assert.match(m, /default 'DUAL_VERIFY'/);
    assert.match(m, /revoke all on public\.ownership_authority_state from authenticated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY DEFINER — three execution contexts
// ─────────────────────────────────────────────────────────────────────────────

describe("Guard trigger: all three execution contexts", () => {
  const m = readApp("supabase/migrations/20260822000010_e0b_final_authority_hardening.sql");

  test("B5.1 the E0-A predicate defect is corrected", () => {
    // E0-A: coalesce(jwt_role, current_user) <> 'service_role'
    //   → in a migration current_user is 'postgres', so legitimate migrations
    //     that touch profiles.role would have been rejected.
    assert.ok(
      !/coalesce\(nullif\(current_setting\('request\.jwt\.claim\.role', true\), ''\), current_user\)/.test(m),
      "the current_user fallback must not decide privilege"
    );
  });

  test("B5.2 direct SQL (no JWT claim) is treated as privileged", () => {
    assert.match(m, /is_privileged boolean := \(jwt_role is null\) or \(jwt_role = 'service_role'\)/);
  });

  test("B5.3 the guard raises 42501 for client roles", () => {
    assert.match(m, /not is_privileged/);
    assert.match(m, /errcode = '42501'/);
  });

  test("B5.4 the function is SECURITY DEFINER with a pinned search_path", () => {
    const fn = m.match(/create or replace function public\.profiles_guard_privileged_columns[\s\S]*?\$\$;/)?.[0];
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = public/);
  });

  test("B5.5 an executable four-context harness ships with the migration", () => {
    for (const ctx of ["ctx1 direct SQL", "ctx2 service_role", "ctx3 authenticated", "ctx4 anon"]) {
      assert.ok(m.includes(ctx), `verification harness must cover ${ctx}`);
    }
    assert.match(m, /PASS  ctx3 authenticated denied with 42501/);
  });

  test("B5.6 the harness also proves the operator is not locked out", () => {
    assert.match(m, /at least one admin principal exists/);
  });
});
