/**
 * E1 Step 0 STOP GATE, executed over HTTP instead of the SQL editor.
 *
 * The runbook's gate is: exactly one consume_login_otp, and p_challenge_id has
 * no DEFAULT. Both failure modes are observable from a client:
 *
 *   - if the OLD 3-arg overload survived  -> a 3-arg call resolves and runs
 *   - if p_challenge_id kept a DEFAULT    -> a 3-arg call resolves and runs
 *
 * So one probe closes both. A 3-arg call MUST fail to resolve (PGRST202).
 */
import crypto from "crypto";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE  = process.env.SUPABASE_SECRET_KEY || "";
if (!URL_BASE || !SERVICE) { console.error("ABORT: env"); process.exit(2); }

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

async function rpc(body) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/consume_login_otp`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload;
  try { payload = await r.json(); } catch { payload = null; }
  return { status: r.status, payload };
}

const results = [];
let failures = 0;
const record = (gate, ok, detail) => {
  results.push({ gate, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) failures++;
};

const main = async () => {
  console.log("\n════════ E1 STEP 0 — SIGNATURE STOP GATE (HTTP) ════════\n");

  // S1 — the 3-argument form must not resolve at all.
  {
    const { status, payload } = await rpc({
      p_user_id: crypto.randomUUID(),
      p_code_hash: sha("000000"),
      p_max_attempts: 3,
    });
    const notFound = status === 404 || payload?.code === "PGRST202";
    record(
      "S1 the 3-argument form does not resolve",
      notFound,
      notFound
        ? `HTTP ${status} ${payload?.code || ""} — no 3-arg overload, and no DEFAULT on p_challenge_id`
        : `HTTP ${status} ${JSON.stringify(payload)} — A WEAK PATH IS STILL CALLABLE`
    );
  }

  // S2 — an explicit NULL must raise, not silently match anything.
  {
    const { status, payload } = await rpc({
      p_user_id: crypto.randomUUID(),
      p_code_hash: sha("000000"),
      p_max_attempts: 3,
      p_challenge_id: null,
    });
    const raised = payload?.code === "22004";
    record(
      "S2 an explicit NULL p_challenge_id raises 22004",
      raised,
      raised
        ? `HTTP ${status} 22004 — ${payload?.message}`
        : `HTTP ${status} ${JSON.stringify(payload)} — expected errcode 22004`
    );
  }

  // S3 — the 4-argument form resolves for service_role (positive control, so a
  // universal 404 cannot be mistaken for S1 passing).
  {
    const { status, payload } = await rpc({
      p_user_id: crypto.randomUUID(),
      p_code_hash: sha("000000"),
      p_max_attempts: 3,
      p_challenge_id: crypto.randomUUID(),
    });
    const resolved = status === 200 && Array.isArray(payload);
    record(
      "S3 positive control — the 4-argument form DOES resolve",
      resolved,
      resolved
        ? `HTTP 200 ${JSON.stringify(payload)} — S1's 404 is signature-specific, not blanket`
        : `HTTP ${status} ${JSON.stringify(payload)} — S1 may be a false pass`
    );
  }

  const w = Math.max(...results.map((r) => r.gate.length));
  for (const r of results) console.log(`  ${r.status.padEnd(4)} ${r.gate.padEnd(w)}  ${r.detail}`);
  console.log("");
  console.log(failures === 0
    ? "  VERDICT: PASS — exactly one contract survives; the weak path is unreachable.\n"
    : `  VERDICT: FAIL — ${failures} gate(s). E1 is not closed.\n`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => { console.error("ABORT:", e?.message); process.exit(2); });
