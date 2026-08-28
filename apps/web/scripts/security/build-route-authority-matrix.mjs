import fs from "node:fs";
import path from "node:path";
import {
  RouteAccessClass,
  classifyRouteAccessWithRule,
} from "../../src/lib/auth/route-access-policy.js";

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

function classify(route, source, methods) {
  const hasHuman = /requireAdminActor|getAdminSessionUser/.test(source);
  const hasCombined = /requireAdminOrCapability/.test(source) ||
    (hasHuman && /requireServiceCapability/.test(source));
  const hasService = /requireServiceCapability|verifyCronAuthorization|verifyWebhookSignature|stripe\.webhooks\.constructEvent/.test(source);

  if (hasCombined) return ["ADMIN_OR_SERVICE_CAPABILITY", "canonical human MFA guard or exact scoped service capability"];
  if (route.startsWith("/api/admin/") || route === "/api/gifts/bulk") {
    if (hasService && !hasHuman) return ["SERVICE_ONLY", "exact scoped service capability"];
    if (!hasHuman) throw new Error(`Privileged route has no canonical authority boundary: ${route}`);
    return ["HUMAN_ADMIN", "canonical requireAdminActor/getAdminSessionUser guard"];
  }
  if (route.startsWith("/api/cron/") || route === "/api/webhook" ||
      route.startsWith("/api/webhooks/") || route === "/api/stripe/webhook") {
    return ["SERVICE_ONLY", "cron or signed webhook machine boundary"];
  }
  const methodPolicies = methods
    .filter((method) => method !== "OPTIONS")
    .map((method) => ({ method, ...classifyRouteAccessWithRule(route, method) }));
  const policyClasses = new Set(methodPolicies.map((item) => item.accessClass));

  if (policyClasses.size === 1 && policyClasses.has(RouteAccessClass.ANONYMOUS_AUTH)) {
    return ["ANONYMOUS_AUTH", "explicit auth/account/recovery allowlist", methodPolicies];
  }
  if (policyClasses.size === 1 && policyClasses.has(RouteAccessClass.TOKEN_SCOPED)) {
    return ["TOKEN_SCOPED", "explicit possession-proof boundary", methodPolicies];
  }
  if (policyClasses.size === 1 && policyClasses.has(RouteAccessClass.LEGACY_RETIREMENT)) {
    return ["LEGACY_RETIREMENT", "explicit non-minting retirement surface", methodPolicies];
  }
  if (policyClasses.size === 1 && policyClasses.has(RouteAccessClass.SYSTEM_PUBLIC)) {
    return ["SYSTEM_PUBLIC", "explicit health/system allowlist", methodPolicies];
  }
  return [
    "AUTHENTICATED_USER",
    /getFanSessionUser|requireAuthenticatedUser|auth\.getUser\(|getSessionUser\(/.test(source)
      ? "central fail-closed middleware plus direct validated session guard"
      : "central fail-closed middleware; unknown routes default protected",
    methodPolicies,
  ];
}

const routes = walk(root).sort().map((file) => {
  const route = routeName(file);
  const source = fs.readFileSync(file, "utf8");
  const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)]
    .map((match) => match[1]);
  const normalizedMethods = [...new Set(methods)].sort();
  const [authority, evidence, methodPolicies = []] = classify(route, source, normalizedMethods);
  return {
    route,
    file: path.relative(process.cwd(), file).split(path.sep).join("/"),
    methods: normalizedMethods,
    authority,
    evidence,
    methodPolicies,
  };
});

const counts = Object.fromEntries([
  "HUMAN_ADMIN", "SERVICE_ONLY", "ADMIN_OR_SERVICE_CAPABILITY",
  "AUTHENTICATED_USER", "ANONYMOUS_AUTH", "TOKEN_SCOPED",
  "LEGACY_RETIREMENT", "SYSTEM_PUBLIC", "PUBLIC", "DEAD",
].map((authority) => [authority, routes.filter((route) => route.authority === authority).length]));

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceRoot: "src/app/api",
  total: routes.length,
  counts,
  routes,
}, null, 2)}\n`);
console.log(`Wrote ${routes.length} routes to ${path.relative(process.cwd(), output)}`);
console.log(JSON.stringify(counts));
