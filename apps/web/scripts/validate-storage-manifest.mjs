#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { extname, join } from "path";
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const manifestPath = getArg("--manifest", "storage/digital-assets.manifest.json");
const localRoot = getArg("--local-root", null);
const strict = args.includes("--strict");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const issues = [];
const warnings = [];

function assetRecords() {
  const records = [];
  for (const artist of manifest.artists || []) {
    for (const asset of artist.assets || []) records.push({ release: artist.artistSlug, ...asset });
  }
  for (const single of manifest.singles || []) {
    for (const asset of single.assets || []) records.push({ release: single.slug, ...asset });
  }
  for (const album of manifest.albums || []) {
    for (const asset of album.assets || []) records.push({ release: album.slug, ...asset });
    for (const track of album.tracks || []) {
      for (const [kind, pattern] of Object.entries(manifest.albumTrackAssetPattern || {})) {
        records.push({
          release: `${album.slug}/${track}`,
          kind,
          required: kind === "audio" || kind === "metadata",
          storagePath: pattern
            .replace("{albumSlug}", album.slug)
            .replace("{trackNumber}-{trackSlug}", track)
            .replace("{trackSlug}", track.replace(/^\d+-/, "")),
        });
      }
    }
  }
  return records;
}

function isLowerKebabPath(path) {
  return path.split("/").every((segment) => {
    if (!segment) return false;
    if (segment.includes(".")) return /^[a-z0-9-]+\.[a-z0-9]+$/.test(segment);
    return /^[a-z0-9-]+$/.test(segment);
  });
}

function readImageDimensions(file) {
  const sips = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  if (sips.status !== 0) return null;
  const width = Number(sips.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(sips.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return width && height ? { width, height } : null;
}

function readVideoDimensions(file) {
  const ffprobe = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    file,
  ], { encoding: "utf8" });
  if (ffprobe.status !== 0) return null;
  const [width, height] = ffprobe.stdout.trim().split("x").map(Number);
  return width && height ? { width, height } : null;
}

function ratioName({ width, height }) {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.03) return "1:1";
  if (Math.abs(ratio - 16 / 9) < 0.03) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.03) return "9:16";
  if (Math.abs(ratio - 4 / 5) < 0.03) return "4:5";
  return `${width}:${height}`;
}

const records = assetRecords();
const seen = new Set();

for (const record of records) {
  if (!isLowerKebabPath(record.storagePath)) {
    issues.push(`Non-standard storage path: ${record.storagePath}`);
  }
  if (seen.has(record.storagePath)) {
    issues.push(`Duplicate storage path: ${record.storagePath}`);
  }
  seen.add(record.storagePath);

  if (record.templatePath && !existsSync(record.templatePath)) {
    issues.push(`Missing metadata template: ${record.templatePath}`);
  }
  if (record.templatePath) {
    try {
      JSON.parse(readFileSync(record.templatePath, "utf8"));
    } catch (err) {
      issues.push(`Invalid JSON template ${record.templatePath}: ${err.message}`);
    }
  }

  if (!localRoot) continue;
  const localFile = join(localRoot, record.storagePath);
  if (record.required && !existsSync(localFile)) {
    issues.push(`Missing required staged file: ${localFile}`);
    continue;
  }
  if (!existsSync(localFile)) continue;

  if (record.kind.includes("cover")) {
    const dims = readImageDimensions(localFile);
    if (!dims) {
      warnings.push(`Could not read cover dimensions: ${localFile}`);
    } else if (dims.width !== dims.height) {
      issues.push(`Cover should be square: ${localFile} (${dims.width}x${dims.height})`);
    } else if (dims.width < 1400) {
      warnings.push(`Cover is smaller than 1400x1400: ${localFile} (${dims.width}x${dims.height})`);
    }
  }

  if (record.kind === "visual" && extname(localFile).toLowerCase() === ".mp4") {
    const dims = readVideoDimensions(localFile);
    if (!dims) {
      warnings.push(`Could not read video dimensions (install ffprobe): ${localFile}`);
    } else if (record.recommendedAspectRatio && ratioName(dims) !== record.recommendedAspectRatio) {
      warnings.push(`Video aspect ratio differs from recommendation: ${localFile} (${ratioName(dims)}, expected ${record.recommendedAspectRatio})`);
    }
  }
}

const r2Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || "2mrrw-media";
const r2Prefix = "digital-assets";

console.log(`Manifest: ${manifestPath}`);
console.log(`Legacy manifest bucket: ${manifest.bucket}`);
console.log(`R2 target: ${r2Bucket} (prefix: ${r2Prefix}/)`);
console.log(`Assets checked: ${records.length}`);
if (localRoot) console.log(`Local root: ${localRoot}`);

for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const issue of issues) console.error(`FAIL: ${issue}`);

if (issues.length || (strict && warnings.length)) {
  process.exit(1);
}

console.log("Storage manifest validation passed.");
