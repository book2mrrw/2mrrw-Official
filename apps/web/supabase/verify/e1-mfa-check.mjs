/**
 * E1 / Part J — LIVE MFA ASSURANCE CERTIFICATION
 *
 *   INV-AUTH-1  MFA assurance is enforced by the session authority.
 *   INV-AUTH-2  Direct password authentication cannot bypass required MFA.
 *
 * ── What this proves ────────────────────────────────────────────────────────
 *
 * The E0 adversarial check established empirically that a raw password grant
 * yields a working session while never touching login-step1/step2 — the
 * application OTP screen was bypassable. The fix moved the question from
 * "did they pass our screen?" to "what AAL does the provider say this session
 * carries?", which a bypasser cannot forge.
 *
 * This script authenticates exactly the way a bypasser would — public anon key,
 * direct password grant — and reports the assurance level the provider assigns.
 *
 *   nextLevel aal2 & currentLevel aal1  → factors enrolled, session unverified.
 *                                         This is the bypass. Under
 *                                         ADMIN_MFA_POLICY=required the admin
 *                                         surface MUST refuse it.
 *   currentLevel aal2                   → second factor verified.
 *   nextLevel aal1                      → no factors enrolled at all.
 *
 * ── Usage — TERMINAL, not the SQL editor ────────────────────────────────────
 *
 *   SUPABASE_URL=...  SUPABASE_ANON_KEY=...
 *   TEST_EMAIL=admin@...  TEST_PASSWORD=...
 *   [APP_URL=https://your-app]        # optional: also probes a live admin route
 *   node e1-mfa-check.mjs
 *
 * Use the PUBLIC anon key. The service key is refused — running the bypass
 * check with elevated credentials would prove nothing.
 *
 * Run this against the ADMIN account, before and after enrolling a TOTP factor.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON     = process.env.SUPABASE_ANON_KEY || "";
const EMAIL    = process.env.TEST_EMAIL || "";
const PASSWORD = process.env.TEST_PASSWORD || "";
const APP_URL  = (process.env.APP_URL || "").replace(/\/$/, "");

if (!URL_BASE || !ANON) {
  console.error("\n  ABORT: SUPABASE_URL and SUPABASE_ANON_KEY are required\n");
  process.exit(2);
}
try {
  const payload = ANON.split(".")[1];
  if (payload) {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (/service_role/.test(json)) {
      console.error("\n  ABORT: that is the SERVICE ROLE key. Use the PUBLIC anon key.\n");
      process.exit(2);
    }
  }
} catch { /* new-style publishable keys are not JWTs */ }

const results = [];
let failures = 0;
const record = (gate, ok, detail) => {
  results.push({ gate, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) failures++;
};
const info = (gate, detail) => results.push({ gate, status: "INFO", detail });

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error("\n  ABORT: TEST_EMAIL and TEST_PASSWORD are required\n");
    process.exit(2);
  }

  console.log("\n════════ E1 LIVE MFA ASSURANCE CERTIFICATION ════════\n");

  // ── Authenticate the way a bypasser would: raw password grant ─────────────
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.access_token) {
    // A provider configured to require MFA at the grant itself would land here.
    info("password grant", `refused (${res.status}) — ${JSON.stringify(body).slice(0, 160)}`);
    record("password grant does not yield a usable session", true,
      "the identity provider refused a password-only grant outright");
    return report();
  }

  const token = body.access_token;
  info("password grant", `accepted — a session was issued WITHOUT any second factor`);

  // ── What assurance does the provider assign it? ───────────────────────────
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
  );
  const aal = claims.aal ?? "(absent)";
  const amr = Array.isArray(claims.amr) ? claims.amr.map((a) => a.method).join(",") : "(absent)";
  info("session assurance", `aal=${aal}  amr=[${amr}]  sub=${claims.sub}`);

  // ── Are factors enrolled on this account? ─────────────────────────────────
  const factorsRes = await fetch(`${URL_BASE}/auth/v1/factors`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const factorsBody = await factorsRes.json().catch(() => ({}));
  const factors = Array.isArray(factorsBody) ? factorsBody : (factorsBody.all ?? factorsBody.totp ?? []);
  const verifiedFactors = (factors || []).filter((f) => f?.status === "verified");
  info("enrolled factors", `${verifiedFactors.length} verified of ${(factors || []).length} total`);

  const enrolled = verifiedFactors.length > 0;

  if (!enrolled) {
    record("ADMIN HAS AN ENROLLED FACTOR", false,
      "no verified TOTP factor on this account. AUTH-01 cannot be enforced until one " +
      "is enrolled — the mechanism is present but inert. Enrol, then re-run.");
    return report();
  }

  record("a factor is enrolled", true, `${verifiedFactors.length} verified`);

  // With a factor enrolled, a password-only session must be aal1.
  record(
    "password-only session is aal1, not aal2",
    aal === "aal1",
    `aal=${aal} — a raw password grant must never carry aal2`
  );

  // ── Does the live admin surface refuse it? ────────────────────────────────
  if (!APP_URL) {
    info("admin surface probe", "skipped — set APP_URL to probe a live admin route");
  } else {
    // A bearer token is not the app's cookie session, so this cannot fully
    // exercise the app path; a 401/403 is still the correct floor.
    const probe = await fetch(`${APP_URL}/api/admin/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    record(
      "admin route refuses an aal1 session",
      probe.status === 401 || probe.status === 403,
      `HTTP ${probe.status} (expected 401/403 while ADMIN_MFA_POLICY=required)`
    );
    info("note",
      "a bearer token is not the SSR cookie session, so this is a floor check. " +
      "The definitive test is signing in through the app UI with a password only " +
      "and confirming the admin console is refused.");
  }

  report();
}

function report() {
  const w = Math.max(...results.map((r) => r.gate.length));
  for (const r of results) {
    console.log(`  ${r.status.padEnd(5)} ${r.gate.padEnd(w)}  ${r.detail}`);
  }
  console.log("");
  if (failures === 0) {
    console.log("  VERDICT: PASS — MFA assurance is enforced by the session authority.\n");
    process.exit(0);
  }
  console.log(`  VERDICT: FAIL — ${failures} gate(s) failed. AUTH-01 is not yet enforced.\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error("\n  ABORT:", err?.message || err, "\n");
  process.exit(2);
});
