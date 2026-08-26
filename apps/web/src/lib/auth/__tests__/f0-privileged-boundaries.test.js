import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const SRC = path.resolve(process.cwd(), "src");
const read = (relativePath) => readFileSync(path.join(SRC, relativePath), "utf8");

test("F0-RATE-1 bulk gifts use the canonical AAL-aware admin actor", () => {
  const source = read("app/api/gifts/bulk/route.js");
  assert.match(source, /requireAdminActor\(\)/);
  assert.doesNotMatch(source, /getFanSessionUser|isAdminUser|bulkGiftRateBuckets|new Map/);
});

test("F0-RATE-2 bulk gifts use a durable fail-closed limiter", () => {
  const source = read("app/api/gifts/bulk/route.js");
  assert.match(source, /checkRateLimit\(req/);
  assert.match(source, /routeKey:\s*"gifts\.bulk"/);
  assert.match(source, /identifier:\s*user\.id/);
  assert.match(source, /failureMode:\s*"closed"/);
  assert.match(source, /status:\s*503/);
});

test("F0-RATE-3 the shared limiter supports explicit fail-closed behavior", () => {
  const source = read("lib/server/rate-limit.js");
  assert.match(source, /failureMode\s*=\s*"open"/);
  assert.match(source, /failureMode === "closed"/);
  assert.match(source, /reason:\s*"rate_limit_unavailable"/);
});

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(target);
    return entry.name === "route.js" ? [target] : [];
  });
}

test("F0-ADMIN-1 every /api/admin route declares a canonical authority boundary", () => {
  const root = path.join(SRC, "app/api/admin");
  const accepted = /getAdminSessionUser|requireAdminActor|requireAdminOrCapability|requireServiceCapability/;
  const violations = routeFiles(root)
    .filter((file) => !accepted.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(violations, []);
});

test("F0-ADMIN-2 admin routes cannot bypass the canonical boundary", () => {
  const root = path.join(SRC, "app/api/admin");
  const violations = routeFiles(root)
    .filter((file) => /getFanSessionUser/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(violations, []);
});
