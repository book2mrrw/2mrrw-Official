import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const RELEASES = [
  {
    releaseTitle: "T.B.H",
    serialPrefix: "T.B.H",
    hiddenPrefix: "tbh",
    editionSize: 100,
    serialPadding: 2,
    productSlug: "exc-card-tbh",
  },
  {
    releaseTitle: "2MRRW: (A.D)",
    serialPrefix: "A.D",
    hiddenPrefix: "ad",
    editionSize: 150,
    serialPadding: 3,
    productSlug: "exc-card-ad",
  },
  {
    releaseTitle: "Love Hz Vol.1",
    serialPrefix: "LHZV1",
    hiddenPrefix: "lhzv1",
    editionSize: 300,
    serialPadding: 3,
    productSlug: "exc-bundle-lovehz",
  },
];

const DEFAULT_OUT_DIR = path.join("storage", "collector-cards");

function argValue(name, fallback) {
  const arg = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function hiddenSecureId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function hashCollectorSecret(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  const headers = [
    "release_title",
    "visible_serial",
    "hidden_secure_id",
    "edition_size",
    "access_tier",
    "verification_status",
    "product_slug",
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function buildRegistry() {
  const seenVisibleSerials = new Set();
  const seenHiddenIds = new Set();
  const cards = [];

  for (const release of RELEASES) {
    for (let index = 1; index <= release.editionSize; index += 1) {
      const serialNumber = String(index).padStart(release.serialPadding, "0");
      const visibleSerial = `${release.serialPrefix} // ${serialNumber}/${release.editionSize}`;
      const rawHiddenSecureId = hiddenSecureId(release.hiddenPrefix);

      if (seenVisibleSerials.has(visibleSerial)) {
        throw new Error(`Duplicate visible serial generated: ${visibleSerial}`);
      }
      if (seenHiddenIds.has(rawHiddenSecureId)) {
        throw new Error("Duplicate hidden secure ID generated");
      }

      seenVisibleSerials.add(visibleSerial);
      seenHiddenIds.add(rawHiddenSecureId);
      cards.push({
        release_title: release.releaseTitle,
        visible_serial: visibleSerial,
        hidden_secure_id: rawHiddenSecureId,
        edition_size: release.editionSize,
        claimed: false,
        claimed_by_user_id: null,
        claim_timestamp: null,
        verification_status: "active",
        access_tier: "verified_collector",
        product_slug: release.productSlug,
        metadata: {
          generated_by: "scripts/generate-collector-cards.mjs",
          hidden_secure_id_storage: "sha256",
        },
      });
    }
  }

  return cards;
}

function buildSupabaseRows(cards) {
  return cards.map((card) => ({
    release_title: card.release_title,
    visible_serial: card.visible_serial,
    hidden_secure_id: hashCollectorSecret(card.hidden_secure_id),
    edition_size: card.edition_size,
    claimed: false,
    claimed_by_user_id: null,
    claim_timestamp: null,
    verification_status: card.verification_status,
    access_tier: card.access_tier,
    product_slug: card.product_slug,
    metadata: card.metadata,
  }));
}

const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
const registryPath = path.join(outDir, "collector-cards.registry.json");
const csvPath = path.join(outDir, "collector-cards.registry.csv");
const importPath = path.join(outDir, "collector-cards.supabase-import.json");

const registry = buildRegistry();
const supabaseRows = buildSupabaseRows(registry);

await mkdir(outDir, { recursive: true });
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
await writeFile(csvPath, `${toCsv(registry)}\n`);
await writeFile(importPath, `${JSON.stringify(supabaseRows, null, 2)}\n`);

const counts = registry.reduce((acc, card) => {
  acc[card.release_title] = (acc[card.release_title] || 0) + 1;
  return acc;
}, {});

console.log("Generated collector-card registry files.");
console.log(`Output directory: ${outDir}`);
console.log(`Manufacturing JSON: ${registryPath}`);
console.log(`Manufacturing CSV: ${csvPath}`);
console.log(`Supabase import JSON: ${importPath}`);
console.log(`Total cards: ${registry.length}`);
for (const release of RELEASES) {
  console.log(`${release.releaseTitle}: ${counts[release.releaseTitle]} cards`);
}
