import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src/app/api");
const output = path.resolve("docs/audit/E1M-ROUTE-AUTHORITY-MATRIX-2026-08-25.json");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.name === "route.js" ? [target] : [];
  });
}

function routeName(file) {
  return `/api/${path.relative(root, path.dirname(file)).split(path.sep).join("/")}`.replace(/\/$/, "");
}

// Route-level helpers that wrap a canonical guard. A helper counts only while
// its own module still calls that guard, so removing the guard from a helper
// fails this script instead of quietly certifying every route that uses it.
const GUARD_WRAPPERS = [
  { name: "authorizeBroadcastAdmin", module: "src/lib/broadcast/admin-http.js", guard: /\brequireAdminActor\(/ },
  { name: "authorizeBroadcastListener", module: "src/lib/broadcast/server-access.js", guard: /\bgetFanSessionUser\(/ },
];
for (const wrapper of GUARD_WRAPPERS) {
  const source = fs.readFileSync(path.resolve(wrapper.module), "utf8");
  if (!wrapper.guard.test(source)) throw new Error(`${wrapper.name} (${wrapper.module}) no longer calls its canonical guard`);
}
// The helper a route uses for this guard, called directly or handed to a
// handler factory (createBroadcastMediaHandler); null when it uses none.
const wrapperFor = (source, guardName) => GUARD_WRAPPERS.find((wrapper) =>
  wrapper.guard.source.includes(guardName) && new RegExp(`\\b${wrapper.name}\\b`).test(source)) || null;
const via = (wrapper) => `via ${wrapper.name} (${wrapper.module})`;

// Machine endpoints that authenticate with their own signed token rather than
// a service capability.
const MACHINE_TOKEN_GUARDS = [
  {
    pattern: /\bverifyLiveRelayPublishToken\(/,
    evidence: "custom relay publish-token verification (verifyLiveRelayPublishToken), not requireServiceCapability",
  },
];

function classify(route, source) {
  const directHuman = /requireAdminActor|getAdminSessionUser/.test(source);
  const humanWrapper = directHuman ? null : wrapperFor(source, "requireAdminActor");
  const hasHuman = directHuman || Boolean(humanWrapper);
  const hasCombined = /requireAdminOrCapability/.test(source) ||
    (hasHuman && /requireServiceCapability/.test(source));
  const hasService = /requireServiceCapability|verifyCronAuthorization|verifyWebhookSignature|stripe\.webhooks\.constructEvent/.test(source);

  if (hasCombined) return ["ADMIN_OR_SERVICE_CAPABILITY", "canonical human MFA guard or exact scoped service capability"];
  if (route.startsWith("/api/admin/") || route === "/api/gifts/bulk") {
    if (hasService && !hasHuman) return ["SERVICE_ONLY", "exact scoped service capability"];
    if (!hasHuman) throw new Error(`Privileged route has no canonical authority boundary: ${route}`);
    return ["HUMAN_ADMIN", humanWrapper
      ? `canonical requireAdminActor guard ${via(humanWrapper)}`
      : "canonical requireAdminActor/getAdminSessionUser guard"];
  }
  if (hasService && !hasHuman) return ["SERVICE_ONLY", "exact scoped service capability"];
  const machineToken = MACHINE_TOKEN_GUARDS.find((guard) => guard.pattern.test(source));
  if (machineToken) return ["SERVICE_ONLY", machineToken.evidence];
  if (route.startsWith("/api/cron/") || route === "/api/webhook" ||
      route.startsWith("/api/webhooks/") || route === "/api/stripe/webhook") {
    return ["SERVICE_ONLY", "cron or signed webhook machine boundary"];
  }
  if (/getFanSessionUser|requireAuthenticatedUser|requireConsumerPrincipal|auth\.getUser\(|getSessionUser\(/.test(source) ||
      wrapperFor(source, "getFanSessionUser") ||
      route === "/api/auth/mfa-session") {
    return ["AUTHENTICATED_USER", "validated Supabase user session"];
  }
  return ["PUBLIC", "public or token-scoped application surface"];
}

const routes = walk(root).sort().map((file) => {
  const route = routeName(file);
  const source = fs.readFileSync(file, "utf8");
  const [authority, evidence] = classify(route, source);
  const methods = [...source.matchAll(/export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)]
    .map((match) => match[1]);
  return {
    route,
    file: path.relative(process.cwd(), file).split(path.sep).join("/"),
    methods: [...new Set(methods)].sort(),
    authority,
    evidence,
  };
});

const counts = Object.fromEntries([
  "HUMAN_ADMIN", "SERVICE_ONLY", "ADMIN_OR_SERVICE_CAPABILITY",
  "AUTHENTICATED_USER", "PUBLIC", "DEAD",
].map((authority) => [authority, routes.filter((route) => route.authority === authority).length]));

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRoot: "src/app/api",
  total: routes.length,
  counts,
  routes,
}, null, 2)}\n`);
console.log(`Wrote ${routes.length} routes to ${path.relative(process.cwd(), output)}`);
console.log(JSON.stringify(counts));
