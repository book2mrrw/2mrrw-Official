/**
 * E1 / Part J — LIVE OTP CONCURRENCY CERTIFICATION
 *
 *   INV-AUTH-3  OTP failed-attempt mutation is atomic.
 *   INV-AUTH-4  OTP successful consumption is single-use under concurrency.
 *
 * ── Why this cannot be an offline test ──────────────────────────────────────
 *
 * The guarantee is provided by `FOR UPDATE` row locking inside
 * consume_login_otp. A mock has no row locks, so faking one would assume the
 * very property under test — the E0-C FakeRedis approach does not transfer.
 * This must run against the real database, over real parallel connections.
 *
 * ── Negative control ────────────────────────────────────────────────────────
 *
 * A concurrency test that never observes a race proves nothing: it may simply
 * be failing to generate contention. Test 0 replicates the OLD read-modify-write
 * in JavaScript against the same table, over the same connections, and asserts
 * it DOES lose updates. If Test 0 stops failing to reach the threshold, the
 * harness is not producing real concurrency and every result below is void.
 *
 * ── Usage — TERMINAL, not the SQL editor ────────────────────────────────────
 *
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  node e1-otp-concurrency.mjs
 *
 * The service role key is required and appropriate here: this certifies a
 * server-side database function, it does not simulate an attacker. (The
 * attacker-side proof is e0-http-check.mjs, which refuses the service key.)
 *
 * Creates and deletes its own disposable OTP rows against one existing user.
 * Writes nothing else and leaves no residue.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE  = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!URL_BASE || !SERVICE) {
  console.error("\n  ABORT: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required\n");
  process.exit(2);
}

const db = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

const results = [];
let failures = 0;
const record = (gate, ok, detail) => {
  results.push({ gate, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) failures++;
};
const info = (gate, detail) => results.push({ gate, status: "INFO", detail });

/** Insert a disposable challenge. Returns its id. */
async function seedChallenge(userId, code, ttlMinutes = 10) {
  const { data, error } = await db
    .from("login_otp")
    .insert({
      user_id: userId,
      code_hash: sha(code),
      expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      attempts: 0,
      used: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed failed: ${error.message}`);
  return data.id;
}

async function readChallenge(id) {
  const { data } = await db.from("login_otp").select("attempts, used").eq("id", id).maybeSingle();
  return data;
}

async function cleanup(ids) {
  if (ids.length) await db.from("login_otp").delete().in("id", ids);
}

/** Tally result strings from the RPC. */
function tally(rows) {
  const t = {};
  for (const r of rows) {
    const k = r?.result ?? "error";
    t[k] = (t[k] || 0) + 1;
  }
  return t;
}

async function main() {
  console.log("\n════════ E1 LIVE OTP CONCURRENCY CERTIFICATION ════════\n");

  // Pick any existing user — login_otp.user_id has an FK to auth.users.
  const { data: users, error: userErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (userErr || !users?.users?.length) {
    console.error("  ABORT: could not resolve a user for the FK:", userErr?.message);
    process.exit(2);
  }
  const userId = users.users[0].id;
  info("subject", `disposable challenges against user ${userId}`);

  const created = [];

  try {
    // ── TEST 0 — NEGATIVE CONTROL ─────────────────────────────────────────
    // Replicate the OLD JS read-modify-write. It MUST lose updates here, or the
    // harness is not generating real contention and nothing below is meaningful.
    {
      const id = await seedChallenge(userId, "111111");
      created.push(id);
      const N = 50;

      const brokenAttempt = async () => {
        const { data: row } = await db.from("login_otp").select("attempts").eq("id", id).maybeSingle();
        const next = (row?.attempts ?? 0) + 1;                       // read, +1 in JS
        await db.from("login_otp").update({ attempts: next }).eq("id", id);  // write back
      };
      await Promise.all(Array.from({ length: N }, brokenAttempt));

      const after = await readChallenge(id);
      record(
        "T0 negative control — old RMW DOES lose updates",
        after.attempts < N,
        after.attempts < N
          ? `attempts=${after.attempts} after ${N} parallel increments (lost ${N - after.attempts})`
          : `attempts=${after.attempts} — NO contention generated; every result below is VOID`
      );
    }

    // ── TEST 1 (E4) — 50 concurrent WRONG codes ───────────────────────────
    {
      const id = await seedChallenge(userId, "222222");
      created.push(id);
      const N = 50;

      const calls = Array.from({ length: N }, () =>
        db.rpc("consume_login_otp", {
          p_user_id: userId,
          p_code_hash: sha("000000"),   // wrong
          p_max_attempts: 3,
          p_challenge_id: id,
        })
      );
      const settled = await Promise.all(calls);
      const rows = settled.map((s) => (Array.isArray(s.data) ? s.data[0] : s.data));
      const t = tally(rows);
      const after = await readChallenge(id);

      info("T1 distribution", JSON.stringify(t));

      record(
        "T1 attempts stops at exactly max_attempts",
        after.attempts === 3,
        `attempts=${after.attempts} (expected exactly 3; a lost update shows <3, a missing lock shows >3)`
      );
      record(
        "T1 challenge is locked",
        after.used === true,
        `used=${after.used}`
      );
      record(
        "T1 exactly one caller observes the lockout",
        (t.locked ?? 0) === 1,
        `locked=${t.locked ?? 0} (expected 1)`
      );
      record(
        "T1 no caller succeeded on a wrong code",
        (t.ok ?? 0) === 0,
        `ok=${t.ok ?? 0} (expected 0)`
      );
    }

    // ── TEST 2 (E5) — 20 concurrent CORRECT codes ─────────────────────────
    {
      const CODE = "654321";
      const id = await seedChallenge(userId, CODE);
      created.push(id);
      const N = 20;

      const calls = Array.from({ length: N }, () =>
        db.rpc("consume_login_otp", {
          p_user_id: userId,
          p_code_hash: sha(CODE),        // correct
          p_max_attempts: 3,
          p_challenge_id: id,
        })
      );
      const settled = await Promise.all(calls);
      const rows = settled.map((s) => (Array.isArray(s.data) ? s.data[0] : s.data));
      const t = tally(rows);
      const after = await readChallenge(id);

      info("T2 distribution", JSON.stringify(t));

      record(
        "T2 exactly ONE successful consumption",
        (t.ok ?? 0) === 1,
        `ok=${t.ok ?? 0} of ${N} concurrent valid submissions (expected exactly 1)`
      );
      record(
        "T2 challenge is burned",
        after.used === true,
        `used=${after.used}`
      );
    }

    // ── TEST 3 — challenge binding (the rev-2 amendment) ──────────────────
    {
      const idA = await seedChallenge(userId, "333333");
      const idB = await seedChallenge(userId, "444444");   // newer row, same user
      created.push(idA, idB);

      // Present challenge A with A's code. A bound function consumes A.
      // The old newest-row-for-user contract would have consumed B and failed.
      const { data } = await db.rpc("consume_login_otp", {
        p_user_id: userId,
        p_code_hash: sha("333333"),
        p_max_attempts: 3,
        p_challenge_id: idA,
      });
      const row = Array.isArray(data) ? data[0] : data;
      const a = await readChallenge(idA);
      const b = await readChallenge(idB);

      record(
        "T3 consumption binds to the presented challenge",
        row?.result === "ok" && a.used === true && b.used === false,
        `result=${row?.result} A.used=${a.used} B.used=${b.used} ` +
        `(the newer challenge B must be untouched)`
      );
    }

    // ── TEST 4 — cross-principal isolation ────────────────────────────────
    {
      const id = await seedChallenge(userId, "555555");
      created.push(id);
      const otherUserId = crypto.randomUUID();   // not the owner

      const { data } = await db.rpc("consume_login_otp", {
        p_user_id: otherUserId,
        p_code_hash: sha("555555"),
        p_max_attempts: 3,
        p_challenge_id: id,
      });
      const row = Array.isArray(data) ? data[0] : data;
      const after = await readChallenge(id);

      record(
        "T4 a challenge cannot be consumed by another principal",
        row?.result === "expired" && after.used === false,
        `result=${row?.result} used=${after.used} (the user_id predicate must reject it)`
      );
    }

    // ── TEST 5 — expiry ───────────────────────────────────────────────────
    {
      const id = await seedChallenge(userId, "666666", -1);   // already expired
      created.push(id);
      const { data } = await db.rpc("consume_login_otp", {
        p_user_id: userId,
        p_code_hash: sha("666666"),
        p_max_attempts: 3,
        p_challenge_id: id,
      });
      const row = Array.isArray(data) ? data[0] : data;
      record(
        "T5 an expired challenge cannot be consumed",
        row?.result === "expired",
        `result=${row?.result}`
      );
    }
  } finally {
    await cleanup(created);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const w = Math.max(...results.map((r) => r.gate.length));
  for (const r of results) {
    console.log(`  ${r.status.padEnd(5)} ${r.gate.padEnd(w)}  ${r.detail}`);
  }
  console.log("");
  if (failures === 0) {
    console.log("  VERDICT: PASS — OTP consumption is atomic and single-use under concurrency.\n");
    process.exit(0);
  }
  console.log(`  VERDICT: FAIL — ${failures} gate(s) failed. E1 is not closed.\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error("\n  ABORT:", err?.message || err, "\n");
  process.exit(2);
});
