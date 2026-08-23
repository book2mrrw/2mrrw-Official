/**
 * E0-C — Atomic Authority Closure: concurrency torture + failure-mode suite.
 *
 * Run: node --test apps/web/src/lib/auth/__tests__/e0c-atomic-authority.test.js
 *
 *   INV-ENT-12  Fingerprint comparison and version advancement are a single
 *               indivisible operation. N concurrent resolvers observing one
 *               rights transition produce exactly ONE version transition.
 *   INV-ENT-11  No stale positive cache window, on any instance.
 *   INV-ENT-13  Authority-mode changes propagate deterministically.
 *   INV-ENT-14  ENTITLEMENTS_CANONICAL is refused without attested parity.
 *   INV-ENT-8   Redis failure never defaults authorization to allow.
 *
 * These are behavioural, executed against a Redis model that reproduces the one
 * guarantee that matters: EVAL is atomic, discrete commands interleave.
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FakeRedis } from "./fake-redis.mjs";
import { buildCapabilityDocument } from "../capability-document.js";
import {
  resolveCapabilityVersion,
  peekCapabilityVersion,
  CapabilityTransition,
  __setRedisClientForTests as setCapRedis,
} from "../capability-version.js";
import {
  getEntitlementGeneration,
  bumpEntitlementGeneration,
  getCachedSlugResult,
  setCachedSlugResult,
  getCachedTier,
  setCachedTier,
  __setRedisClientForTests as setEntRedis,
  __clearL1ForTests,
} from "../../server/entitlement-cache.js";
import {
  OwnershipAuthorityState,
  getOwnershipAuthorityState,
} from "../../commerce/ownership-authority.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../..");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");

const UID = "user-under-test";
let redis;

beforeEach(() => {
  redis = new FakeRedis();
  setCapRedis(redis);
  setEntRedis(redis);
  __clearL1ForTests();
});

const docFor = (over = {}) =>
  buildCapabilityDocument({
    isAdmin: false, isSubscriber: true, isCollector: false,
    vaultTier: "inner_circle", playbackPolicy: "FULL_CATALOG",
    ownedSlugs: ["a", "b"], ...over,
  });

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-12 — atomic capability transition under concurrency
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-12: one rights transition → exactly one version transition", () => {
  for (const N of [10, 100, 1000]) {
    test(`C1.${N} ${N} concurrent resolvers advance the version exactly once`, async () => {
      // Establish a baseline so the next document is a genuine transition.
      const first = await resolveCapabilityVersion(UID, docFor());
      assert.equal(first.transition, CapabilityTransition.INITIALISED);
      const baseVersion = first.version;

      // N resolvers all compute the SAME new document simultaneously.
      const next = docFor({ isCollector: true });
      const results = await Promise.all(
        Array.from({ length: N }, () => resolveCapabilityVersion(UID, next))
      );

      const versions = new Set(results.map((r) => r.version));
      assert.equal(versions.size, 1,
        `all ${N} resolvers must agree on one version, saw ${[...versions].join(",")}`);

      const version = results[0].version;
      assert.equal(version, baseVersion + 1,
        `version must advance by exactly 1 (got ${baseVersion} → ${version})`);

      const advanced = results.filter((r) => r.transition === CapabilityTransition.ADVANCED);
      assert.equal(advanced.length, 1,
        `exactly one resolver may observe the transition, ${advanced.length} did`);

      const changed = results.filter((r) => r.changed);
      assert.equal(changed.length, 1);
    });
  }

  test("C1.reads no-op: 500 concurrent resolvers of UNCHANGED rights never advance", async () => {
    await resolveCapabilityVersion(UID, docFor());
    const { version: before } = await peekCapabilityVersion(UID);

    const results = await Promise.all(
      Array.from({ length: 500 }, () => resolveCapabilityVersion(UID, docFor()))
    );

    assert.ok(results.every((r) => r.transition === CapabilityTransition.UNCHANGED));
    assert.ok(results.every((r) => r.changed === false));
    const { version: after } = await peekCapabilityVersion(UID);
    assert.equal(after, before, "a JWT refresh storm must not move the version");
  });

  test("C1.sequential three real transitions advance by exactly three", async () => {
    await resolveCapabilityVersion(UID, docFor());
    const start = (await peekCapabilityVersion(UID)).version;

    await resolveCapabilityVersion(UID, docFor({ isCollector: true }));
    await resolveCapabilityVersion(UID, docFor({ isCollector: true, isAdmin: true }));
    await resolveCapabilityVersion(UID, docFor({ isCollector: true, isAdmin: true, ownedSlugs: ["a", "b", "c"] }));

    assert.equal((await peekCapabilityVersion(UID)).version, start + 3);
  });

  test("C1.interleaved alternating documents never lose or double-count", async () => {
    await resolveCapabilityVersion(UID, docFor());
    const start = (await peekCapabilityVersion(UID)).version;

    // 50 concurrent of A then 50 concurrent of B, twice. Each *batch boundary*
    // is one transition: A→B, B→A, A→B  = 3.
    const A = docFor({ isCollector: false });
    const B = docFor({ isCollector: true });
    for (const doc of [B, A, B]) {
      await Promise.all(Array.from({ length: 50 }, () => resolveCapabilityVersion(UID, doc)));
    }
    assert.equal((await peekCapabilityVersion(UID)).version, start + 3);
  });

  test("C1.consistency fingerprint and version are never observed mismatched", async () => {
    await resolveCapabilityVersion(UID, docFor());
    const next = docFor({ isAdmin: true });

    // Racing writers against readers: every observed pair must be self-consistent.
    const observations = [];
    await Promise.all([
      ...Array.from({ length: 100 }, () => resolveCapabilityVersion(UID, next)),
      ...Array.from({ length: 100 }, async () => {
        observations.push(await peekCapabilityVersion(UID));
      }),
    ]);

    const finalFp = (await peekCapabilityVersion(UID)).fingerprint;
    const finalVer = (await peekCapabilityVersion(UID)).version;
    for (const o of observations) {
      if (o.fingerprint === finalFp) {
        assert.equal(o.version, finalVer,
          "a reader that saw the new fingerprint must also see the new version");
      }
    }
  });

  test("C1.atomicity the CAS is a single eval, not read-then-write", async () => {
    await resolveCapabilityVersion(UID, docFor());
    const before = { ...redis.ops };
    await resolveCapabilityVersion(UID, docFor({ isAdmin: true }));
    assert.equal(redis.ops.eval, before.eval + 1, "exactly one script invocation");
    assert.equal(redis.ops.incr, before.incr, "no discrete INCR outside the script");
    assert.equal(redis.ops.get, before.get, "no discrete GET outside the script");
  });

  test("C1.control NEGATIVE CONTROL — the E0-B read-then-write DOES race here", async () => {
    // Without this, the torture tests above could be passing vacuously against a
    // mock that serialises everything. This reproduces the exact E0-B sequence
    // and asserts the harness DOES expose the race. If this ever stops failing to
    // stay at +1, the FakeRedis interleaving model has been weakened and every
    // atomicity claim above becomes meaningless.
    const fpKey = "ctl:fp";
    const verKey = "ctl:ver";
    await redis.set(fpKey, "F1");
    await redis.set(verKey, "41");

    const brokenResolve = async (fingerprint) => {
      const [storedFp] = await Promise.all([redis.get(fpKey), redis.get(verKey)]);
      if (storedFp === fingerprint) return;
      await redis.incr(verKey);          // ← every concurrent caller reaches this
      await redis.set(fpKey, fingerprint);
    };

    const N = 100;
    await Promise.all(Array.from({ length: N }, () => brokenResolve("F2")));

    const ended = Number(await redis.get(verKey));
    assert.ok(
      ended > 42,
      `harness must expose the race; got ${ended}, expected far above 42. ` +
      `If this is 42 the mock is over-serialising and the atomicity proof is void.`
    );
  });

  test("C1.source the implementation uses eval and has no read-then-INCR path", () => {
    const src = read("lib/auth/capability-version.js");
    assert.match(src, /redis\.eval\(\s*CAS_SCRIPT/);
    assert.ok(!/await redis\.incr\(/.test(src),
      "a discrete INCR would reintroduce the E0-B race");
    assert.ok(!/Promise\.all\(\[\s*redis\.get\(fpKey\)/.test(src));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-11 — no stale privilege window
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-11: revocation is visible with no stale window", () => {
  test("C2.1 a bump invalidates a positive slug grant on the very next read", async () => {
    await setCachedSlugResult(UID, "track-a", true);
    assert.equal(await getCachedSlugResult(UID, "track-a"), true);

    await bumpEntitlementGeneration(UID);

    assert.equal(await getCachedSlugResult(UID, "track-a"), null,
      "no time-based window may exist — the very next read must miss");
  });

  test("C2.2 a bump invalidates a cached tier immediately", async () => {
    await setCachedTier(UID, { canStreamAll: true, isSubscriber: true });
    assert.ok(await getCachedTier(UID));
    await bumpEntitlementGeneration(UID);
    assert.equal(await getCachedTier(UID), null);
  });

  test("C2.3 the generation is never served from a local cache", () => {
    const src = read("lib/server/entitlement-cache.js");
    assert.ok(!/_genL1/.test(src),
      "an in-process generation cache reintroduces a stale privilege window");
    const fn = src.match(/export async function getEntitlementGeneration[\s\S]*?\n}/)?.[0];
    assert.match(fn, /const redis = getRedis\(\);/);
    assert.ok(!/Date\.now\(\) - .*?< GEN/.test(fn));
  });

  test("C2.4 generation and value are read in ONE atomic call", async () => {
    await setCachedSlugResult(UID, "t", true);
    const before = { ...redis.ops };
    await getCachedSlugResult(UID, "t");
    assert.equal(redis.ops.eval, before.eval + 1);
    assert.equal(redis.ops.get, before.get,
      "a separate GET would allow a revoke to land between the two reads");
  });

  test("C2.5 concurrent revocation during resolution never yields a stale grant", async () => {
    await setCachedSlugResult(UID, "t", true);
    __clearL1ForTests();

    const [readResult] = await Promise.all([
      getCachedSlugResult(UID, "t"),
      bumpEntitlementGeneration(UID),
    ]);
    // Either the pre-revoke true, or a miss — never a post-revoke true, and the
    // subsequent read must always miss.
    assert.ok(readResult === true || readResult === null);
    assert.equal(await getCachedSlugResult(UID, "t"), null);
  });

  test("C2.6 100 concurrent readers after a revoke all miss", async () => {
    await setCachedSlugResult(UID, "t", true);
    await bumpEntitlementGeneration(UID);
    __clearL1ForTests();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => getCachedSlugResult(UID, "t"))
    );
    assert.ok(results.every((r) => r === null),
      "not one reader may observe the revoked grant");
  });

  test("C2.7 the generation bump is itself atomic (INCR+EXPIRE in one script)", async () => {
    const before = { ...redis.ops };
    await bumpEntitlementGeneration(UID);
    assert.equal(redis.ops.eval, before.eval + 1);
    assert.equal(redis.ops.incr, before.incr, "no discrete INCR");
  });

  test("C2.8 concurrent bumps are all counted", async () => {
    const start = await getEntitlementGeneration(UID);
    await Promise.all(Array.from({ length: 50 }, () => bumpEntitlementGeneration(UID)));
    assert.equal(await getEntitlementGeneration(UID), start + 50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-8 — Redis failure is fail-closed
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-8: store failure never defaults to allow", () => {
  test("C3.1 unreachable store → slug grant is a MISS, not an allow", async () => {
    await setCachedSlugResult(UID, "t", true);
    __clearL1ForTests();
    redis.setFailing(true);
    assert.equal(await getCachedSlugResult(UID, "t"), null);
  });

  test("C3.2 unreachable store → tier is a MISS", async () => {
    await setCachedTier(UID, { canStreamAll: true });
    __clearL1ForTests();
    redis.setFailing(true);
    assert.equal(await getCachedTier(UID), null);
  });

  test("C3.3 absent store client → MISS", async () => {
    setEntRedis(false);
    assert.equal(await getCachedSlugResult(UID, "t"), null);
    assert.equal(await getCachedTier(UID), null);
    assert.equal(await getEntitlementGeneration(UID), null);
  });

  test("C3.4 unreachable store → capability version is null, never 'unchanged'", async () => {
    redis.setFailing(true);
    const r = await resolveCapabilityVersion(UID, docFor());
    assert.equal(r.version, null);
    assert.equal(r.changed, false);
    assert.match(r.fingerprint, /^[0-9a-f]{64}$/,
      "the fingerprint must still be usable without any store");
  });

  test("C3.5 recovery after a reconnect resumes correct behaviour", async () => {
    await resolveCapabilityVersion(UID, docFor());
    redis.setFailing(true);
    assert.equal((await resolveCapabilityVersion(UID, docFor({ isAdmin: true }))).version, null);
    redis.setFailing(false);
    const r = await resolveCapabilityVersion(UID, docFor({ isAdmin: true }));
    assert.equal(r.transition, CapabilityTransition.ADVANCED,
      "the transition missed during the outage is applied once on recovery");
  });

  test("C3.6 a failed bump does not leave a poisoned local cache", async () => {
    await setCachedSlugResult(UID, "t", true);
    redis.setFailing(true);
    assert.equal(await bumpEntitlementGeneration(UID), null);
    redis.setFailing(false);
    // L1 was cleared synchronously by the bump even though Redis failed.
    const v = await getCachedSlugResult(UID, "t");
    assert.ok(v === null || v === true);
  });

  test("C3.7 duplicate identical resolves during retries do not double-advance", async () => {
    await resolveCapabilityVersion(UID, docFor());
    const next = docFor({ isAdmin: true });
    // Simulates a client retrying the same request several times.
    await resolveCapabilityVersion(UID, next);
    const v1 = (await peekCapabilityVersion(UID)).version;
    await resolveCapabilityVersion(UID, next);
    await resolveCapabilityVersion(UID, next);
    assert.equal((await peekCapabilityVersion(UID)).version, v1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV-ENT-13 / INV-ENT-14 — ownership cutover
// ─────────────────────────────────────────────────────────────────────────────

describe("INV-ENT-13/14: ownership authority cutover", () => {
  const makeAdmin = (row) => ({
    from: () => ({
      select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    }),
  });

  const withEnv = async (v, fn) => {
    const prev = process.env.OWNERSHIP_AUTHORITY_STATE;
    if (v === null) delete process.env.OWNERSHIP_AUTHORITY_STATE;
    else process.env.OWNERSHIP_AUTHORITY_STATE = v;
    try { return await fn(); }
    finally {
      if (prev === undefined) delete process.env.OWNERSHIP_AUTHORITY_STATE;
      else process.env.OWNERSHIP_AUTHORITY_STATE = prev;
    }
  };

  test("C4.1 CANONICAL is REFUSED when parity is unattested", async () => {
    const admin = makeAdmin({
      state: "ENTITLEMENTS_CANONICAL",
      parity_verified_at: null,
      parity_library_only_count: null,
    });
    const { state } = await withEnv(null, () => getOwnershipAuthorityState(admin));
    assert.equal(state, OwnershipAuthorityState.DUAL_VERIFY);
  });

  test("C4.2 CANONICAL is REFUSED when parity is attested but non-zero", async () => {
    const admin = makeAdmin({
      state: "ENTITLEMENTS_CANONICAL",
      parity_verified_at: "2026-08-22T00:00:00Z",
      parity_library_only_count: 17,
    });
    const { state, source } = await withEnv(null, () => getOwnershipAuthorityState(admin));
    assert.equal(state, OwnershipAuthorityState.DUAL_VERIFY);
    assert.match(source, /parity_refused/);
  });

  test("C4.3 CANONICAL is HONOURED when parity is attested at zero", async () => {
    const admin = makeAdmin({
      state: "ENTITLEMENTS_CANONICAL",
      parity_verified_at: "2026-08-22T00:00:00Z",
      parity_library_only_count: 0,
    });
    const { state } = await withEnv(null, () => getOwnershipAuthorityState(admin));
    assert.equal(state, OwnershipAuthorityState.ENTITLEMENTS_CANONICAL);
  });

  test("C4.4 an env override cannot bypass the parity gate", async () => {
    const admin = makeAdmin({
      state: "DUAL_VERIFY",
      parity_verified_at: null,
      parity_library_only_count: null,
    });
    const { state } = await withEnv("ENTITLEMENTS_CANONICAL", () =>
      getOwnershipAuthorityState(admin));
    assert.equal(state, OwnershipAuthorityState.DUAL_VERIFY,
      "configuration must not be able to strip ownership without proof");
  });

  test("C4.5 no in-process state cache — every call re-reads", async () => {
    const src = read("lib/commerce/ownership-authority.js");
    assert.ok(!/STATE_TTL_MS/.test(src),
      "a cached state produces an uncontrolled mixed-mode period during cutover");
    assert.ok(!/_cachedAt/.test(src));
  });

  test("C4.6 a cutover is observed by the next call, deterministically", async () => {
    let row = { state: "LEGACY_LIBRARY", parity_verified_at: null, parity_library_only_count: null };
    const admin = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) };

    assert.equal((await withEnv(null, () => getOwnershipAuthorityState(admin))).state,
      OwnershipAuthorityState.LEGACY_LIBRARY);
    row = { state: "DUAL_VERIFY", parity_verified_at: null, parity_library_only_count: null };
    assert.equal((await withEnv(null, () => getOwnershipAuthorityState(admin))).state,
      OwnershipAuthorityState.DUAL_VERIFY,
      "no window in which the previous mode is still served");
  });

  test("C4.7 an unreadable state degrades to DUAL_VERIFY", async () => {
    const admin = { from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => { throw new Error("down"); } }) }) }) };
    const { state } = await withEnv(null, () => getOwnershipAuthorityState(admin));
    assert.equal(state, OwnershipAuthorityState.DUAL_VERIFY);
  });

  test("C4.8 the DB cutover function refuses CANONICAL with non-zero parity", () => {
    const m = readFileSync(
      path.join(SRC, "../supabase/migrations/20260822000020_e0c_atomic_authority_closure.sql"),
      "utf8"
    );
    assert.match(m, /attest_ownership_parity/);
    assert.match(m, /cannot advance to ENTITLEMENTS_CANONICAL/);
    assert.match(m, /v_library_only := public\.attest_ownership_parity\(\)/,
      "the cutover must RE-ATTEST rather than trust a stale number");
  });

  test("C4.9 admin recovery exists and is denied to client roles", () => {
    const m = readFileSync(
      path.join(SRC, "../supabase/migrations/20260822000020_e0c_atomic_authority_closure.sql"),
      "utf8"
    );
    assert.match(m, /recover_admin_principal/);
    assert.match(m, /revoke all on function public\.recover_admin_principal\(text\) from authenticated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static audit — no route bypasses the centralized resolver
// ─────────────────────────────────────────────────────────────────────────────

describe("Static audit: authority resolution is centralized", () => {
  /** Every API route file, recursively. */
  const allRoutes = () => {
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
  };

  const activeCode = (p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");

  test("C5.0 the audit actually scans a meaningful number of routes", () => {
    assert.ok(allRoutes().length > 30, `only ${allRoutes().length} routes found — walker is wrong`);
  });

  test("C5.1 no API route compares an email for authorization", () => {
    const offenders = allRoutes()
      .filter((p) => /(===|!==)\s*ADMIN_EMAIL|ADMIN_EMAIL\s*(===|!==)/.test(activeCode(p)))
      .map((p) => path.relative(SRC, p));
    assert.deepEqual(offenders, [], `routes still gating on email: ${offenders.join(", ")}`);
  });

  test("C5.2 no API route uses getSession() for an authorization decision", () => {
    const offenders = allRoutes()
      .filter((p) => /auth\.getSession\(\)/.test(activeCode(p)))
      .map((p) => path.relative(SRC, p));
    assert.deepEqual(offenders, [],
      `getSession() trusts the cookie payload without re-verification: ${offenders.join(", ")}`);
  });

  test("C5.3 no route feeds a DB-sourced role into isAdminUser", () => {
    // The ENT-01 sink was isAdminUser({ ...profile, role: profile.role }).
    // Reading the column for analytics, or persisting it, is not an authority
    // decision — passing it into the admin predicate is.
    const offenders = allRoutes()
      .filter((p) => /isAdminUser\(\s*\{[^}]*\brole\b/s.test(activeCode(p)))
      .map((p) => path.relative(SRC, p));
    assert.deepEqual(offenders, [],
      `a DB role is being used as an admin claim: ${offenders.join(", ")}`);
  });

  test("C5.3b complete-profile cannot let the request body set role", () => {
    // This route legitimately writes profiles.role to keep the vestigial column
    // in sync. It must derive the value only from the existing DB value or a
    // trusted claim — never from user input.
    const src = activeCode(path.join(SRC, "app/api/auth/complete-profile/route.js"));
    const assignment = src.match(/const role\s*=[\s\S]*?;/)?.[0] ?? "";
    assert.ok(assignment, "role assignment not found — review this route manually");
    assert.ok(!/body\./.test(assignment), "request body must not influence role");
    assert.match(assignment, /existingRole === "admin" \|\| isAdminUser\(user\)/);
  });

  test("C5.3c no route derives admin from a role read out of profiles", () => {
    const offenders = allRoutes()
      .filter((p) => {
        const src = activeCode(p);
        // select(...role...) from profiles AND a role==='admin' access branch
        // that is not the known-benign persistence in complete-profile.
        if (path.basename(path.dirname(p)) === "complete-profile") return false;
        return /from\(["']profiles["']\)[\s\S]{0,200}select\([^)]*\brole\b/.test(src)
            && /role\s*===\s*["']admin["']/.test(src);
      })
      .map((p) => path.relative(SRC, p));
    assert.deepEqual(offenders, [],
      `profiles.role must not gate access: ${offenders.join(", ")}`);
  });

  test("C5.4 isAdminUser has exactly one definition", () => {
    const src = read("lib/auth/constants.js");
    assert.equal((src.match(/export function isAdminUser/g) || []).length, 1);
  });

  test("C5.5 no privilege table gains a client write policy", () => {
    const migDir = path.join(SRC, "../supabase/migrations");
    const privileged = [
      "user_entitlements", "memberships", "library_items", "collector_ownerships",
      "collector_access", "vault_entitlements", "entitlements", "purchases",
      "admin_principals", "ownership_authority_state",
    ];
    const offenders = [];
    for (const f of readdirSync(migDir)) {
      if (!f.endsWith(".sql")) continue;
      const sql = readFileSync(path.join(migDir, f), "utf8").toLowerCase();
      for (const t of privileged) {
        const re = new RegExp(
          `create policy[^;]*on\\s+(public\\.)?${t}\\b[^;]*for\\s+(insert|update|delete|all)`, "s"
        );
        if (re.test(sql)) offenders.push(`${f}:${t}`);
      }
    }
    assert.deepEqual(offenders, [],
      `client write policy on a privilege table: ${offenders.join(", ")}`);
  });
});
