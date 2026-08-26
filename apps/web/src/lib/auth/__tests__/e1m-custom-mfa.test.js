import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root = process.cwd();
const read = (p) => readFileSync(path.join(root,p),"utf8");
const migration = read("supabase/migrations/20260825000050_custom_mfa_authority.sql");
const authority = read("src/lib/auth/mfa-authority.js");

test("INV-MFA-3/6 authority is opaque, server-only, user and session bound", () => {
  assert.match(migration,/token_hash text not null unique/);
  assert.match(migration,/auth_session_id text not null/);
  assert.match(migration,/enable row level security/g);
  assert.match(migration,/revoke all[\s\S]*anon,authenticated/);
  assert.match(authority,/httpOnly: true/);
});
test("INV-MFA-8 generation revocation is atomic and immediate", () => {
  assert.match(migration,/bump_2mrrw_mfa_generation/);
  assert.match(migration,/s\.generation=g\.generation/);
  assert.match(migration,/generation_bumped/);
});
test("INV-MFA-9 OTP replay cannot reach mint boundary", () => {
  const route=read("src/app/api/auth/login-step2/route.js");
  assert.ok(route.indexOf('result !== "ok"') < route.lastIndexOf("issueMfaAuthority"));
  assert.equal((route.match(/issueMfaAuthority\s*\(/g)||[]).length,1);
});
test("INV-MFA-10/13 raw password and missing config cannot authorize admin", () => {
  assert.match(authority,/custom_mfa_required/);
  assert.match(authority,/custom_mfa_configuration_missing/);
  const guard=read("src/lib/auth/admin-api-guard.js");
  assert.match(guard,/verifyMfaAuthority/);
  assert.match(authority, /String\(process\.env\.HUMAN_ADMIN_MFA_REQUIRED \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "true"/);
});
test("INV-MFA-7 sign-out revokes cookie and durable authority", () => {
  assert.match(authority,/revoke_2mrrw_mfa_authority/);
  assert.match(authority,/cookieOptions\(0\)/);
});

test("INV-MFA-4 every repository API route is classified exactly once", () => {
  const matrix = JSON.parse(read("docs/audit/E1M-ROUTE-AUTHORITY-MATRIX-2026-08-25.json"));
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.name === "route.js" ? [target] : [];
  });
  const files = walk(path.join(root, "src/app/api"));
  assert.equal(matrix.total, files.length);
  assert.equal(new Set(matrix.routes.map((item) => item.route)).size, files.length);
  for (const item of matrix.routes.filter((item) => item.authority === "HUMAN_ADMIN")) {
    assert.match(read(item.file), /requireAdminActor|getAdminSessionUser/);
  }
});

test("INV-MFA-4 privileged guard symbols are explicitly imported", () => {
  const matrix = JSON.parse(read("docs/audit/E1M-ROUTE-AUTHORITY-MATRIX-2026-08-25.json"));
  for (const item of matrix.routes.filter(({ authority }) =>
    ["HUMAN_ADMIN", "ADMIN_OR_SERVICE_CAPABILITY", "SERVICE_ONLY"].includes(authority))) {
    const source = read(item.file);
    for (const symbol of ["requireAdminActor", "getAdminSessionUser", "requireAdminOrCapability", "requireServiceCapability", "ServiceCapability"]) {
      if (!new RegExp(`\\b${symbol}\\b`).test(source)) continue;
      assert.match(source, new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']@/lib/auth/admin-api-guard["']`),
        `${item.route} references ${symbol} without importing the canonical guard`);
    }
  }
});

test("INV-MFA-1/4 canonical human guard has no Supabase AAL policy fallback", () => {
  const guard = read("src/lib/auth/admin-api-guard.js");
  assert.doesNotMatch(guard, /requireMfaAssurance|getAuthenticatorAssuranceLevel|ADMIN_MFA_POLICY/);
  assert.match(guard, /verifyMfaAuthority/);
});

test("INV-MFA-8 password reset and admin revocation advance MFA generation", () => {
  assert.match(read("src/app/reset-password/page.js"), /\/api\/auth\/mfa-session/);
  assert.match(read("src/app/api/auth/mfa-session/route.js"), /resetMfaAuthorityForUser/);
  assert.match(read("src/lib/auth/admin-authority.js"), /bump_2mrrw_mfa_generation[\s\S]*admin_privilege_revoked/);
});

test("INV-MFA expiration has a controlled service-only production proof", () => {
  const expirationMigration = read("supabase/migrations/20260825000051_mfa_expiration_certification.sql");
  assert.match(expirationMigration, /expires_at > now\(\)/);
  assert.match(expirationMigration, /return not v_accepted/);
  assert.match(expirationMigration, /revoke all[\s\S]*public, anon, authenticated/);
  assert.match(read("src/app/api/admin/diagnostics/mfa-expiration/route.js"), /requireAdminActor/);
});
