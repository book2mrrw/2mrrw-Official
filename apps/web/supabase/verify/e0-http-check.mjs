/**
 * E0 END-TO-END ESCALATION CHECK
 *
 * The SQL certification runs as a privileged role, so it bypasses RLS and column
 * privileges and can only exercise the guard trigger. THIS script is the
 * definitive proof: it acts as a real, ordinary logged-in user, holding nothing
 * but the public anon key and their own session — exactly what an attacker has.
 *
 * It attempts the two escalation paths for real and asserts both fail.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node e0-http-check.mjs
 *
 * Environment (a NON-admin test account — create a throwaway one):
 *
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY=eyJ...            # the PUBLIC anon key, never the service key
 *   TEST_EMAIL=throwaway@example.com
 *   TEST_PASSWORD=...
 *
 * Or skip the login and supply a token directly:
 *   TEST_ACCESS_TOKEN=eyJ...
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *
 *   - Never send the service-role key to this script. It must prove that a
 *     CLIENT cannot escalate; running it with elevated credentials would produce
 *     a meaningless pass.
 *   - It restores full_name and clears the user_metadata probe key on exit.
 *   - Run it against staging first if the test account matters.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const EMAIL = process.env.TEST_EMAIL || "";
const PASSWORD = process.env.TEST_PASSWORD || "";
let TOKEN = process.env.TEST_ACCESS_TOKEN || "";

const results = [];
let failures = 0;

function record(gate, ok, detail) {
  results.push({ gate, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) failures += 1;
}
function info(gate, detail) {
  results.push({ gate, status: "INFO", detail });
}

function die(msg) {
  console.error(`\n  ABORT: ${msg}\n`);
  process.exit(2);
}

if (!URL_BASE || !ANON) die("SUPABASE_URL and SUPABASE_ANON_KEY are required");
if (ANON.length > 0 && /service_role/.test(Buffer.from(ANON.split(".")[1] || "", "base64").toString("utf8"))) {
  die("that looks like the SERVICE ROLE key. This check must run with the ANON key.");
}

const rest = (path, init = {}) =>
  fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${TOKEN || ANON}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

async function login() {
  if (TOKEN) {
    info("auth", "using supplied TEST_ACCESS_TOKEN");
    return;
  }
  if (!EMAIL || !PASSWORD) {
    die("supply TEST_ACCESS_TOKEN, or TEST_EMAIL + TEST_PASSWORD");
  }
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    die(`login failed (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  TOKEN = body.access_token;
  info("auth", `signed in as ${body.user?.email} (${body.user?.id})`);
  return body.user;
}

async function whoami() {
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

async function main() {
  await login();
  const user = await whoami();
  const uid = user?.id;
  if (!uid) die("could not resolve the authenticated user id");

  // ── Pre-flight: this must be an ORDINARY account, or the test is void ─────
  const pre = await rest(`profiles?id=eq.${uid}&select=role,full_name`);
  const preRow = (await pre.json().catch(() => []))[0] || {};
  if (preRow.role === "admin") {
    die("the test account is already an admin — use a throwaway NON-admin account");
  }
  info("subject", `user ${uid}, role=${preRow.role ?? "<null>"}`);
  const originalName = preRow.full_name ?? "";

  // ── ENT-01: direct self-promotion via PostgREST ───────────────────────────
  {
    const res = await rest(`profiles?id=eq.${uid}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ role: "admin" }),
    });
    const txt = await res.text();
    const blocked = !res.ok;
    record(
      "ENT-01 self-promote profiles.role",
      blocked,
      blocked
        ? `blocked (${res.status})`
        : `ACCEPTED (${res.status}) — ESCALATION IS OPEN: ${txt.slice(0, 160)}`
    );

    // Verify by reading back, in case the write silently no-op'd.
    const check = await rest(`profiles?id=eq.${uid}&select=role`);
    const nowRole = ((await check.json().catch(() => []))[0] || {}).role;
    record(
      "ENT-01 role unchanged after attempt",
      nowRole !== "admin",
      `role is now ${nowRole ?? "<null>"}`
    );
  }

  // ── Ordinary edits must still work (not over-locked) ──────────────────────
  {
    const probe = `e0-check-${Date.now()}`;
    const res = await rest(`profiles?id=eq.${uid}`, {
      method: "PATCH",
      body: JSON.stringify({ full_name: probe }),
    });
    record(
      "benign profile edit still permitted",
      res.ok,
      res.ok ? "full_name update accepted" : `BLOCKED (${res.status}) — users cannot edit their profile`
    );
    await rest(`profiles?id=eq.${uid}`, {
      method: "PATCH",
      body: JSON.stringify({ full_name: originalName }),
    });
  }

  // ── admin_principals must be unreachable ──────────────────────────────────
  {
    const res = await rest("admin_principals?select=user_id");
    let rows = [];
    try { rows = await res.json(); } catch { /* non-JSON body is fine */ }
    const denied = !res.ok || (Array.isArray(rows) && rows.length === 0);
    record(
      "admin_principals unreadable by client",
      denied,
      denied ? `denied or empty (${res.status})` : `LEAKED ${rows.length} row(s)`
    );

    const w = await rest("admin_principals", {
      method: "POST",
      body: JSON.stringify({ user_id: uid }),
    });
    record(
      "admin_principals unwritable by client",
      !w.ok,
      !w.ok ? `blocked (${w.status})` : `ACCEPTED (${w.status}) — SELF-GRANT IS OPEN`
    );
  }

  // ── ownership_authority_state must be unreachable ─────────────────────────
  {
    const res = await rest("ownership_authority_state?select=state");
    let rows = [];
    try { rows = await res.json(); } catch { /* ignore */ }
    const denied = !res.ok || (Array.isArray(rows) && rows.length === 0);
    record(
      "ownership_authority_state unreachable",
      denied,
      denied ? `denied or empty (${res.status})` : `LEAKED: ${JSON.stringify(rows).slice(0, 120)}`
    );
  }

  // ── ENT-02: poison user_metadata, then prove it grants nothing ────────────
  {
    const set = await fetch(`${URL_BASE}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { role: "admin" } }),
    });
    info(
      "ENT-02 user_metadata write",
      set.ok
        ? "user_metadata.role='admin' was accepted by the auth API (expected — it is self-service)"
        : `auth API rejected the metadata write (${set.status})`
    );

    // The write succeeding is fine. What must NOT happen is it conferring anything.
    const after = await whoami();
    const claimed = after?.user_metadata?.role;
    const appMeta = after?.app_metadata?.role;
    record(
      "ENT-02 app_metadata NOT polluted",
      appMeta !== "admin",
      `app_metadata.role = ${appMeta ?? "<none>"} (user_metadata.role = ${claimed ?? "<none>"})`
    );

    const res = await rest(`profiles?id=eq.${uid}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
    });
    record(
      "ENT-02 metadata claim grants no DB privilege",
      !res.ok,
      !res.ok ? `still blocked (${res.status})` : `ACCEPTED (${res.status}) — metadata conferred privilege`
    );

    const ap = await rest("admin_principals?select=user_id");
    let apRows = [];
    try { apRows = await ap.json(); } catch { /* ignore */ }
    record(
      "ENT-02 metadata claim grants no table access",
      !ap.ok || (Array.isArray(apRows) && apRows.length === 0),
      `admin_principals still ${ap.ok ? "empty" : "denied"} (${ap.status})`
    );

    // Clean up the probe key.
    await fetch(`${URL_BASE}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { role: null } }),
    });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const w = Math.max(...results.map((r) => r.gate.length));
  console.log("\n════════ E0 END-TO-END ESCALATION CHECK ════════\n");
  for (const r of results) {
    console.log(`  ${r.status.padEnd(6)} ${r.gate.padEnd(w)}  ${r.detail}`);
  }
  console.log("");
  if (failures === 0) {
    console.log("  VERDICT: PASS — a real client session cannot escalate.\n");
    process.exit(0);
  } else {
    console.log(`  VERDICT: FAIL — ${failures} gate(s) failed. DO NOT PROCEED.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n  ABORT:", err?.message || err, "\n");
  process.exit(2);
});
