/**
 * Read-only entitlements vs library_items parity (storefront Supabase).
 *
 *   E2E_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/check-entitlements-parity.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set E2E_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { buildEntitlementsParityReport } = await import("../src/lib/commerce/entitlements-parity.js");
const report = await buildEntitlementsParityReport(admin);

console.log(JSON.stringify(report, null, 2));

const drift = (report.libraryOnly || 0) + (report.entitlementsOnly || 0);
if (report.entitlementsTablePresent && drift > 0) {
  console.warn(`parity drift: libraryOnly=${report.libraryOnly} entitlementsOnly=${report.entitlementsOnly}`);
  process.exit(2);
}

process.exit(0);
