import readline from "node:readline";
import { createServerClient } from "@supabase/ssr";

const APP_URL = "https://www.2mrrw.com";

function prompt(label, { secret = false } = {}) {
  if (!secret) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(label, (answer) => { rl.close(); resolve(answer); }));
  }
  return new Promise((resolve) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    const onData = (buffer) => {
      const text = buffer.toString("utf8");
      if (text === "\u0003") process.exit(130);
      if (text === "\r" || text === "\n") {
        process.stdin.off("data", onData);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(value);
      } else if (text === "\u007f" || text === "\b") value = value.slice(0, -1);
      else if (!/[\u0000-\u001f]/.test(text)) value += text;
    };
    process.stdin.on("data", onData);
  });
}

function absorbSetCookies(jar, response) {
  const rawValues = response.headers.getSetCookie?.() || [];
  if (rawValues.length === 0) {
    const combined = response.headers.get("set-cookie");
    if (combined) rawValues.push(combined);
  }
  const values = rawValues.flatMap((value) =>
    value.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/));
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) jar.set(name, cookieValue);
    else jar.delete(name);
  }
}

const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
async function request(path, { method = "GET", jar, body } = {}) {
  const response = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      ...(jar?.size ? { Cookie: cookieHeader(jar) } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (jar) absorbSetCookies(jar, response);
  return response;
}

async function publicSupabaseConfig() {
  const html = await fetch(APP_URL).then((response) => response.text());
  const assets = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], APP_URL).href);
  let url = "";
  let key = "";
  for (const asset of assets) {
    const source = await fetch(asset).then((response) => response.text()).catch(() => "");
    url ||= source.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0] || "";
    key ||= source.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
      || source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] || "";
    if (url && key) return { url, key };
  }
  throw new Error("public_browser_configuration_unavailable");
}

const email = String(await prompt("Admin email: ")).trim();
let password = await prompt("Admin password (hidden): ", { secret: true });
const otpJar = new Map();
const step1 = await request("/api/auth/login-step1", {
  method: "POST", jar: otpJar, body: { email, password },
});
if (!step1.ok) {
  password = "";
  console.error(`LOGIN STEP 1: FAIL (${step1.status})`);
  process.exit(2);
}
const pendingJar = new Map(otpJar);
console.log("LOGIN STEP 1: PASS — enter the newly delivered code below.");
const otp = String(await prompt("Six-digit OTP (hidden): ", { secret: true })).trim();
const step2 = await request("/api/auth/login-step2", {
  method: "POST", jar: otpJar, body: { code: otp },
});
console.log(`LEGITIMATE MFA MINT: ${step2.ok ? "PASS" : "FAIL"} (${step2.status})`);
if (!step2.ok) process.exit(1);
const capturedAuthCookie = [...otpJar.keys()].some((name) => name.startsWith("2mrrw-auth-token"));
const capturedMfaCookie = [...otpJar.keys()].some((name) => name.includes("2mrrw_mfa"));
console.log(`SESSION COOKIE CAPTURE: ${capturedAuthCookie && capturedMfaCookie ? "PASS" : "FAIL"}`);
const stateResponse = await request("/api/auth/mfa-session", { jar: otpJar });
const state = await stateResponse.json().catch(() => ({}));
console.log(`SERVER SESSION STATE: authenticated=${Boolean(state.authenticated)} admin=${Boolean(state.admin)} mfa=${Boolean(state.mfaVerified)} reason=${state.mfaReason || "none"}`);

const adminAllowed = await request("/api/admin/releases", { jar: otpJar });
console.log(`VERIFIED MFA ADMIN ACCESS: ${adminAllowed.ok ? "PASS" : "FAIL"} (${adminAllowed.status})`);
const expiration = await request("/api/admin/diagnostics/mfa-expiration", {
  method: "POST", jar: otpJar, body: {},
});
const expirationBody = await expiration.json().catch(() => ({}));
const expirationDenied = expiration.ok && expirationBody.expiredAuthorityDenied === true;
console.log(`EXPIRED MFA AUTHORITY ACCEPTANCE: ${expirationDenied ? "PASS" : "FAIL"} (${expiration.status})`);

const replayJar = new Map(pendingJar);
const replay = await request("/api/auth/login-step2", {
  method: "POST", jar: replayJar, body: { code: otp },
});
const replayDenied = replay.status === 400 || replay.status === 401 || replay.status === 409;
const replayAdmin = await request("/api/admin/releases", { jar: replayJar });
const replayMintDenied = replayDenied && (replayAdmin.status === 401 || replayAdmin.status === 403);
console.log(`OTP REPLAY MFA MINT: ${replayMintDenied ? "PASS" : "FAIL"} (${replay.status}/${replayAdmin.status})`);

const publicConfig = await publicSupabaseConfig();
const rawJar = new Map();
const rawClient = createServerClient(publicConfig.url, publicConfig.key, {
  cookies: {
    getAll: () => [...rawJar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => rawJar.set(name, value)),
  },
});
const rawAuth = await rawClient.auth.signInWithPassword({ email, password });
password = "";
if (rawAuth.error) {
  console.error("CROSS-SESSION SETUP: FAIL");
  process.exit(2);
}
const mixedJar = new Map(rawJar);
for (const [name, value] of otpJar) {
  if (name.includes("2mrrw_mfa")) mixedJar.set(name, value);
}
const mixed = await request("/api/admin/releases", { jar: mixedJar });
const mixingDenied = mixed.status === 401 || mixed.status === 403;
console.log(`CROSS-SESSION MFA ACCEPTANCE: ${mixingDenied ? "PASS" : "FAIL"} (${mixed.status})`);
await rawClient.auth.signOut({ scope: "local" }).catch(() => {});

const reset = await request("/api/auth/mfa-session", { method: "POST", jar: otpJar, body: {} });
const afterReset = await request("/api/admin/releases", { jar: otpJar });
const generationDenied = reset.ok && (afterReset.status === 401 || afterReset.status === 403);
console.log(`GENERATION REVOCATION: ${generationDenied ? "PASS" : "FAIL"} (${reset.status}/${afterReset.status})`);

const pass = adminAllowed.ok && expirationDenied && replayMintDenied && mixingDenied && generationDenied;
console.log(`E1-M ADVERSARIAL SESSION SUITE: ${pass ? "PASS" : "FAIL"}`);
process.exitCode = pass ? 0 : 1;
