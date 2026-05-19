import crypto from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const DEFAULTS = {
  editionSize: 100,
  serialPadding: 2,
  serialPrefix: "TBH",
  releaseTitle: "T.B.H",
  expectedDisplayPrefix: "T.B.H",
  hiddenPrefix: "tbh",
  accessTier: "verified_collector",
  verificationStatus: "active",
  productSlug: "exc-card-tbh",
  outPath: path.join("storage", "collector-cards", "collector-cards.supabase-import.json"),
};

function argValue(name, fallback = null) {
  const arg = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function hashCollectorSecret(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCsvRegistry(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const visibleIndex = headers.indexOf("visible_serial");
  const hiddenIndex = headers.indexOf("hidden_secure_id");
  if (visibleIndex === -1 || hiddenIndex === -1) return null;

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return {
      visible_serial: cells[visibleIndex],
      hidden_secure_id: cells[hiddenIndex],
    };
  });
}

function parseCompactRegistry(text, options) {
  const serialPattern = `${escapeRegExp(options.serialPrefix)} \\/\\/ \\d{${options.serialPadding},3}\\/${options.editionSize}`;
  const trailingPunctuationPattern = "[`'\"\\)\\]\\.,;:]*";
  const rowPattern = new RegExp(
    `(${serialPattern})\\s*(${escapeRegExp(options.hiddenPrefix)}_[A-Za-z0-9_-]+?)(?=\\s*${serialPattern}|${trailingPunctuationPattern}\\s*$|[\`'\"\\)\\]\\.,;:])`,
    "g",
  );
  const rows = [...text.matchAll(rowPattern)].map((match) => ({
    visible_serial: match[1].trim(),
    hidden_secure_id: match[2].trim(),
  }));

  if (rows.length === 0) {
    throw new Error("Compact registry rows were not found with the expected visible serial and hidden ID prefixes");
  }

  return rows;
}

function parseJsonRegistry(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((row) => ({
      visible_serial: row.visible_serial,
      hidden_secure_id: row.hidden_secure_id,
    }));
  } catch {
    return null;
  }
}

function parseRegistry(text, options) {
  return parseJsonRegistry(text) || parseCsvRegistry(text) || parseCompactRegistry(text, options);
}

function expectedSerial({ serialPrefix, index, editionSize, serialPadding }) {
  const serialNumber = String(index).padStart(serialPadding, "0");
  return `${serialPrefix} // ${serialNumber}/${editionSize}`;
}

function formatSerialRanges(numbers, options) {
  if (numbers.length === 0) return "";

  const ranges = [];
  let start = numbers[0];
  let previous = numbers[0];

  for (const number of numbers.slice(1)) {
    if (number === previous + 1) {
      previous = number;
      continue;
    }

    ranges.push([start, previous]);
    start = number;
    previous = number;
  }
  ranges.push([start, previous]);

  return ranges
    .map(([rangeStart, rangeEnd]) => {
      const startSerial = expectedSerial({ ...options, index: rangeStart });
      const endSerial = expectedSerial({ ...options, index: rangeEnd });
      return rangeStart === rangeEnd ? startSerial : `${startSerial} through ${endSerial}`;
    })
    .join(", ");
}

function validateRegistry(rows, options) {
  const errors = [];
  const seenHiddenIds = new Set();
  const seenVisibleSerials = new Set();
  const hiddenPrefix = `${options.hiddenPrefix}_`;
  const hiddenIdPattern = new RegExp(`^${escapeRegExp(hiddenPrefix)}[A-Za-z0-9_-]{16,}$`);
  const expectedVisibleSerials = new Map(
    Array.from({ length: options.editionSize }, (_, index) => {
      const serialNumber = index + 1;
      return [expectedSerial({ ...options, index: serialNumber }), serialNumber];
    }),
  );
  const foundSerialNumbers = new Set();

  if (rows.length !== options.editionSize) {
    errors.push(`Expected ${options.editionSize} cards, found ${rows.length}`);
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const visibleSerial = String(row.visible_serial || "").trim();
    const hiddenSecureId = String(row.hidden_secure_id || "").trim();

    if (!expectedVisibleSerials.has(visibleSerial)) {
      errors.push(`Row ${rowNumber} has unexpected visible serial ${visibleSerial || "(blank)"}`);
    } else {
      foundSerialNumbers.add(expectedVisibleSerials.get(visibleSerial));
    }
    if (!hiddenSecureId.startsWith(hiddenPrefix)) {
      errors.push(`Row ${rowNumber} hidden secure ID does not start with ${hiddenPrefix}`);
    } else if (!hiddenIdPattern.test(hiddenSecureId)) {
      errors.push(`Row ${rowNumber} hidden secure ID is too short or contains unsupported characters`);
    }
    if (seenVisibleSerials.has(visibleSerial)) {
      errors.push(`Duplicate visible serial at row ${rowNumber}`);
    }
    if (seenHiddenIds.has(hiddenSecureId)) {
      errors.push(`Duplicate hidden secure ID at row ${rowNumber}`);
    }

    seenVisibleSerials.add(visibleSerial);
    seenHiddenIds.add(hiddenSecureId);
  });

  const missingSerialNumbers = Array.from({ length: options.editionSize }, (_, index) => index + 1)
    .filter((serialNumber) => !foundSerialNumbers.has(serialNumber));
  if (missingSerialNumbers.length > 0) {
    errors.push(`Missing visible serials: ${formatSerialRanges(missingSerialNumbers, options)}`);
  }

  return errors;
}

function buildSupabaseRows(rows, options) {
  return rows.map((row) => ({
    release_title: options.releaseTitle,
    visible_serial: row.visible_serial.trim(),
    hidden_secure_id: hashCollectorSecret(row.hidden_secure_id.trim()),
    edition_size: options.editionSize,
    claimed: false,
    claimed_by_user_id: null,
    claim_timestamp: null,
    verification_status: options.verificationStatus,
    access_tier: options.accessTier,
    product_slug: options.productSlug,
    metadata: {
      source: "manufacturing_registry_import",
      hidden_secure_id_storage: "sha256",
      visible_serial_preserved_from_registry: true,
    },
  }));
}

const inputPath = argValue("--input");
if (!inputPath) {
  throw new Error("Usage: node scripts/prepare-collector-card-import.mjs --input=storage/collector-cards/tbh-registry.input.txt [--out=...]");
}

const options = {
  ...DEFAULTS,
  editionSize: parsePositiveInteger(argValue("--edition-size", String(DEFAULTS.editionSize)), "--edition-size"),
  serialPadding: parsePositiveInteger(argValue("--serial-padding", String(DEFAULTS.serialPadding)), "--serial-padding"),
  serialPrefix: argValue("--serial-prefix", DEFAULTS.serialPrefix),
  releaseTitle: argValue("--release-title", DEFAULTS.releaseTitle),
  expectedDisplayPrefix: argValue("--expected-display-prefix", DEFAULTS.expectedDisplayPrefix),
  hiddenPrefix: argValue("--hidden-prefix", DEFAULTS.hiddenPrefix),
  productSlug: argValue("--product-slug", DEFAULTS.productSlug),
  accessTier: argValue("--access-tier", DEFAULTS.accessTier),
  verificationStatus: argValue("--verification-status", DEFAULTS.verificationStatus),
};

const outPath = argValue("--out", DEFAULTS.outPath);
const registryText = await readFile(inputPath, "utf8");
const registryRows = parseRegistry(registryText, options);
const errors = validateRegistry(registryRows, options);

if (errors.length > 0) {
  console.error("Collector-card registry validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const supabaseRows = buildSupabaseRows(registryRows, options);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(supabaseRows, null, 2)}\n`);

console.log("Collector-card registry validation passed.");
console.log(`Release title: ${options.releaseTitle}`);
console.log(`Cards: ${registryRows.length}`);
console.log(`Serial range: ${registryRows[0].visible_serial} through ${registryRows.at(-1).visible_serial}`);
if (options.serialPrefix !== options.expectedDisplayPrefix) {
  console.warn(`Warning: visible serial prefix "${options.serialPrefix}" differs from expected display prefix "${options.expectedDisplayPrefix}". Preserved pasted serials.`);
}
console.log(`Supabase import JSON: ${outPath}`);
console.log("Import field note: hidden_secure_id contains a SHA-256 digest, not the raw hidden ID.");
