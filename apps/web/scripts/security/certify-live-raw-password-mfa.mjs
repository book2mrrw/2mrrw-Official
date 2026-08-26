import readline from "node:readline";
import { createServerClient } from "@supabase/ssr";
import matrix from "../../docs/audit/E1M-ROUTE-AUTHORITY-MATRIX-2026-08-25.json" with { type: "json" };

const APP_URL = "https://www.2mrrw.com";
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function discoverPublicSupabaseConfig() {
  const html = await fetch(APP_URL).then((response) => response.text());
  const assets = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], APP_URL).href);
  for (const asset of assets) {
    const source = await fetch(asset).then((response) => response.text()).catch(() => "");
    supabaseUrl ||= source.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0];
    supabaseKey ||= source.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
      || source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
    if (supabaseUrl && supabaseKey) return;
  }
}

if (!supabaseUrl || !supabaseKey) await discoverPublicSupabaseConfig();
if (!supabaseUrl || !supabaseKey) {
  console.error("Could not discover the already-public Supabase browser configuration.");
  process.exit(2);
}

function prompt(label, { secret = false } = {}) {
  if (!secret) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(label, (answer) => { rl.close(); resolve(answer); }));
  }
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = "";
    output.write(label);
    input.setRawMode?.(true);
    input.resume();
    const onData = (buffer) => {
      const text = buffer.toString("utf8");
      if (text === "\u0003") process.exit(130);
      if (text === "\r" || text === "\n") {
        input.off("data", onData);
        input.setRawMode?.(false);
        input.pause();
        output.write("\n");
        resolve(value);
      } else if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
      } else if (!/[\u0000-\u001f]/.test(text)) {
        value += text;
      }
    };
    input.on("data", onData);
  });
}

const email = String(await prompt("Admin email: ")).trim();
let password = await prompt("Admin password (hidden): ", { secret: true });
const jar = new Map();
const supabase = createServerClient(supabaseUrl, supabaseKey, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)),
  },
});

const { error } = await supabase.auth.signInWithPassword({ email, password });
password = "";
if (error) {
  console.error("RAW PASSWORD CERTIFICATION: AUTHENTICATION FAILED");
  process.exit(2);
}

const cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
const privileged = matrix.routes.filter(({ authority }) =>
  authority === "HUMAN_ADMIN" || authority === "ADMIN_OR_SERVICE_CAPABILITY");
const results = [];
for (const item of privileged) {
  const method = item.methods.includes("GET") ? "GET" : item.methods[0];
  if (!method) continue;
  const route = item.route.replaceAll("[id]", "e1m-certification-nonexistent");
  const response = await fetch(`${APP_URL}${route}`, {
    method,
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: method === "GET" || method === "HEAD" ? undefined : "{}",
    redirect: "manual",
  });
  const denied = response.status === 401 || response.status === 403;
  results.push({ route: item.route, method, status: response.status, denied });
  console.log(`${denied ? "PASS" : "FAIL"} ${response.status} ${method} ${item.route}`);
}

await supabase.auth.signOut({ scope: "local" }).catch(() => {});
jar.clear();
const failures = results.filter(({ denied }) => !denied);
console.log(`RAW PASSWORD HUMAN-ADMIN DENIAL: ${failures.length === 0 ? "PASS" : "FAIL"}`);
console.log(`ROUTES TESTED: ${results.length}; FAILURES: ${failures.length}`);
process.exitCode = failures.length === 0 ? 0 : 1;
