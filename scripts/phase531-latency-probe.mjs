#!/usr/bin/env node
/**
 * Phase 5.3.1 — Master vs stream object size / HEAD latency probe.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) throw new Error("Missing .env.local");
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

const { r2Client, R2_BUCKET } = await import("@/lib/storage/r2.js");
const { resolveAudioFile } = await import("@/lib/media/entity-resolver.js");

const PROBES = [
  {
    label: "single: hour-glass",
    masterStorage: "singles/hour-glass/",
    streamKey: "streaming/singles/hour-glass/hour-glass_192.m4a",
  },
  {
    label: "feature: 2-heavy",
    masterStorage: "features/2-heavy/",
    streamKey: "streaming/features/2-heavy/2-heavy_192.m4a",
  },
  {
    label: "mixtape: ad/01-2mrrws-ntro",
    masterStorage: "mixtapes-and-eps/ad/01-2mrrws-ntro/",
    streamKey: "streaming/mixtapes-and-eps/ad/01-2mrrws-ntro/01-2mrrws-ntro_192.m4a",
  },
];

async function headObjectMeta(key) {
  const normalized = String(key || "").replace(/^\//, "");
  const started = performance.now();
  try {
    const resp = await r2Client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: normalized })
    );
    return {
      ok: true,
      headMs: Math.round((performance.now() - started) * 10) / 10,
      bytes: resp.ContentLength ?? null,
      contentType: resp.ContentType ?? null,
    };
  } catch {
    return { ok: false, headMs: Math.round((performance.now() - started) * 10) / 10, bytes: null };
  }
}

async function probeMaster(storagePath) {
  const started = performance.now();
  const key = await resolveAudioFile(storagePath);
  const resolveMs = Math.round((performance.now() - started) * 10) / 10;
  if (!key) return { key: null, resolveMs, headMs: null, bytes: null, ok: false };
  const meta = await headObjectMeta(key);
  return { key, resolveMs, ...meta };
}

async function probeStream(streamKey) {
  const meta = await headObjectMeta(streamKey);
  return { key: streamKey, ...meta };
}

const results = [];
for (const item of PROBES) {
  const master = await probeMaster(item.masterStorage);
  const stream = await probeStream(item.streamKey);
  results.push({
    label: item.label,
    master,
    stream,
    sizeReductionPct:
      master.bytes && stream.bytes
        ? Math.round((1 - stream.bytes / master.bytes) * 1000) / 10
        : null,
    headDeltaMs:
      master.headMs != null && stream.headMs != null
        ? Math.round((stream.headMs - master.headMs) * 10) / 10
        : null,
  });
}

console.log(JSON.stringify(results, null, 2));
