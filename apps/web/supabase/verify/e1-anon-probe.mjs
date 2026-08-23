/**
 * E1 — ATTACKER-SIDE WIRE PROOF (anon role only).
 *
 * The migration asserted has_function_privilege('anon', …) = false at SQL level.
 * This proves the same thing the way an attacker would actually experience it:
 * over HTTPS, with the PUBLIC key that ships in the browser bundle.
 *
 * Uses the anon key ONLY. Presenting the service key here would prove nothing.
 */
import crypto from "crypto";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON     = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
if (!URL_BASE || !ANON) { console.error("ABORT: need SUPABASE_URL + SUPABASE_ANON_KEY"); process.exit(2); }

// Guard: refuse to run with anything that is not the anon role.
try {
  const claims = JSON.parse(Buffer.from(ANON.split(".")[1], "base64").toString());
  if (claims.role !== "anon") {
    console.error(`ABORT: key role is "${claims.role}" — this probe requires the anon key.`);
    process.exit(2);
  }
} catch { /* non-JWT publishable key: allowed, it is public by construction */ }

const results = []; let failures = 0;
const record = (g, ok, d) => { results.push({ g, s: ok ? "PASS" : "FAIL", d }); if (!ok) failures++; };

const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };

const main = async () => {
  console.log("\n════════ E1 — ATTACKER-SIDE WIRE PROOF (anon) ════════\n");

  // A1 — anon must not be able to EXECUTE the OTP primitive.
  {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/consume_login_otp`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        p_user_id: crypto.randomUUID(),
        p_code_hash: crypto.createHash("sha256").update("000000").digest("hex"),
        p_max_attempts: 999999,
        p_challenge_id: crypto.randomUUID(),
      }),
    });
    const j = await r.json().catch(() => null);
    const denied = r.status === 404 || r.status === 401 || r.status === 403;
    record("A1 anon cannot execute consume_login_otp", denied,
      `HTTP ${r.status} ${j?.code || ""} ${denied ? "— denied" : "— EXECUTABLE BY THE BROWSER KEY"}`);
  }

  // A2 — anon must not be able to read authentication material.
  {
    const r = await fetch(`${URL_BASE}/rest/v1/login_otp?select=id,code_hash,user_id&limit=1`, { headers: H });
    const j = await r.json().catch(() => null);
    const leaked = Array.isArray(j) && j.length > 0;
    record("A2 anon cannot read login_otp rows", !leaked,
      leaked ? `HTTP ${r.status} — ${j.length} ROW(S) DISCLOSED` : `HTTP ${r.status} ${j?.code || ""} — no rows`);
  }

  // A3 — anon must not be able to WRITE a challenge (forge a second factor).
  {
    const r = await fetch(`${URL_BASE}/rest/v1/login_otp`, {
      method: "POST", headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: crypto.randomUUID(),
        code_hash: crypto.createHash("sha256").update("123456").digest("hex"),
        expires_at: new Date(Date.now() + 600000).toISOString(),
      }),
    });
    const j = await r.json().catch(() => null);
    const wrote = r.status === 201 || (Array.isArray(j) && j.length > 0);
    record("A3 anon cannot insert a forged challenge", !wrote,
      wrote ? `HTTP ${r.status} — CHALLENGE FORGED` : `HTTP ${r.status} ${j?.code || ""} — refused`);
  }

  // A4 — POSITIVE CONTROL. The first version of this gate hit /rest/v1/, which
  // is service-role-only by design in current Supabase, so it 401'd for reasons
  // unrelated to authorization and would have made A1–A3 unfalsifiable.
  //
  // The control has to be a surface anon is SUPPOSED to reach. If `tracks`
  // returns 200 on the same key that gets 401 on login_otp, the difference is a
  // per-object authorization decision and A1–A3 are real.
  {
    const r = await fetch(`${URL_BASE}/rest/v1/tracks?select=id&limit=1`, { headers: H });
    const ok = r.status === 200;
    record("A4 positive control — this key DOES reach a public table", ok,
      `HTTP ${r.status} on tracks — ${ok
        ? "key is live, so the 401s above are per-object denials"
        : "key is not usable at all; A1–A3 are false passes"}`);
  }

  const w = Math.max(...results.map((r) => r.g.length));
  for (const r of results) console.log(`  ${r.s.padEnd(4)} ${r.g.padEnd(w)}  ${r.d}`);
  console.log("");
  console.log(failures === 0
    ? "  VERDICT: PASS — the browser key reaches none of the OTP surface.\n"
    : `  VERDICT: FAIL — ${failures} gate(s).\n`);
  process.exit(failures === 0 ? 0 : 1);
};
main().catch((e) => { console.error("ABORT:", e?.message); process.exit(2); });
