#!/usr/bin/env node
/**
 * Compare .env.local keys against .env.example — names only, never print values.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./anchor.mjs";

function parseEnvKeys(content) {
  const keys = new Set();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      keys.add(trimmed.slice(0, eq).trim());
    }
  }
  return keys;
}

export function checkEnv({ dryRun = false } = {}) {
  const examplePath = join(ROOT, ".env.example");
  const localPath = join(ROOT, ".env.local");

  if (!existsSync(examplePath)) {
    console.warn("WARN  .env.example not found — skipping env validation");
    return { ok: true, missing: [] };
  }

  const required = parseEnvKeys(readFileSync(examplePath, "utf8"));
  const optionalEmpty = new Set([
    "STRIPE_INNER_CIRCLE_PRICE_ID",
    "STRIPE_INNER_CIRCLE_PRODUCT_ID",
    "ADMIN_SEED_SECRET",
  ]);

  if (!existsSync(localPath)) {
    console.warn("WARN  .env.local missing — copy from .env.example and fill keys for local dev");
    console.warn(`      Required key names (${required.size}): ${[...required].sort().join(", ")}`);
    return { ok: false, missing: [...required] };
  }

  const localKeys = parseEnvKeys(readFileSync(localPath, "utf8"));
  const missing = [];
  const empty = [];

  for (const key of required) {
    if (optionalEmpty.has(key)) continue;
    if (!localKeys.has(key)) {
      missing.push(key);
    }
  }

  if (missing.length) {
    console.error(`FAIL  .env.local missing keys: ${missing.join(", ")}`);
    return { ok: false, missing, empty };
  }

  console.log("PASS  .env.local contains all .env.example key names (values not inspected)");
  if (dryRun) {
    console.log("      (dry-run: would not block on empty values)");
  }
  return { ok: true, missing: [], empty };
}

export async function checkControlSystemSync(anchor) {
  const url =
    process.env.NEXT_PUBLIC_CONTROL_SYSTEM_API_URL ||
    anchor?.controlSystemUrl ||
    null;

  if (!url) {
    console.log("SKIP  Control system URL not set — sync check omitted");
    return true;
  }

  const healthUrl = url.replace(/\/$/, "") + "/api/health";
  try {
    const res = await fetch(healthUrl, { method: "GET", signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      console.log(`PASS  Control system reachable (${healthUrl})`);
      return true;
    }
    console.warn(`WARN  Control system returned ${res.status} (${healthUrl})`);
    return false;
  } catch (err) {
    console.warn(`WARN  Control system sync check failed: ${err.message}`);
    return false;
  }
}
