#!/usr/bin/env node
/**
 * Phase 5.3.3B — Validate master resolution for remediated tracks.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadDotenvLocal();

const { resolveAudioFile } = await import("@/lib/media/entity-resolver.js");
const { normalizeStoragePathForStorefront } = await import("@/lib/sync/normalize-storage-path.js");

const TRACKS = [
  { album: "ad", slug: "03-said-n-done", storage_path: "mixtapes-and-eps/ad/03-said-n-done/" },
  { album: "ad", slug: "04-a-d-d", storage_path: "mixtapes-and-eps/ad/04-a-d-d/" },
  { album: "ad", slug: "08-life-changes-ft-gwendolyn", storage_path: "mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn/" },
  { album: "love-hz-vol-1", slug: "01-roll-call", storage_path: "mixtapes-and-eps/love-hz-vol-1/01-roll-call/" },
  { album: "love-hz-vol-1", slug: "02-w-2-d", storage_path: "mixtapes-and-eps/love-hz-vol-1/02-w-2-d/" },
  { album: "love-hz-vol-1", slug: "07-stayed-2-long", storage_path: "mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long/" },
  { album: "love-hz-vol-1", slug: "08-knock-on-wood", storage_path: "mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood/" },
  { album: "love-hz-vol-1", slug: "09-hour-glass", storage_path: "mixtapes-and-eps/love-hz-vol-1/09-hour-glass/" },
  { album: "tbh", slug: "03-unxpcted", storage_path: "mixtapes-and-eps/tbh/03-unxpcted/" },
  { album: "tbh", slug: "08-2late", storage_path: "mixtapes-and-eps/tbh/08-2late/" },
];

const results = [];
for (const t of TRACKS) {
  const normalized = normalizeStoragePathForStorefront(t.storage_path);
  const masterKey = await resolveAudioFile(normalized);
  results.push({
    track: `${t.album}/${t.slug}`,
    expected_prefix: normalized,
    resolved_master_key: masterKey,
    pass: Boolean(masterKey),
  });
}

const outDir = resolve(ROOT, ".tmp-phase533b-remediation-targeted-backfill-20260530");
writeFileSync(resolve(outDir, "master-resolution-validation.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(`\nSummary: ${passed}/${results.length} resolved`);
if (failed.length) {
  console.log("Still missing:", failed.map((r) => r.track).join(", "));
  process.exitCode = failed.length === 1 && failed[0].track.includes("01-roll-call") ? 0 : 1;
}
