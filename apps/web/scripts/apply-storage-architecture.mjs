#!/usr/bin/env node
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const manifest = JSON.parse(readFileSync("storage/digital-assets.manifest.json", "utf8"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const bucket = supabase.storage.from(manifest.bucket);

const uploaded = [];
const skipped = [];

function jsonBlob(value) {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

function keepBlob(label) {
  return new Blob([`${label}\n`], { type: "text/plain" });
}

async function uploadIfMissing(path, body, contentType) {
  const { error } = await bucket.upload(path, body, {
    contentType,
    upsert: false,
  });

  if (!error) {
    uploaded.push(path);
    return;
  }

  if (String(error.message || "").toLowerCase().includes("already exists")) {
    skipped.push(path);
    return;
  }

  throw new Error(`${path}: ${error.message}`);
}

function collectPrefixes() {
  const prefixes = new Set(["singles/", "albums/", "artists/"]);

  for (const artist of manifest.artists || []) {
    prefixes.add(artist.storagePrefix);
  }
  for (const single of manifest.singles || []) {
    prefixes.add(single.storagePrefix);
  }
  for (const album of manifest.albums || []) {
    prefixes.add(album.storagePrefix);
    for (const track of album.tracks || []) {
      prefixes.add(`${album.storagePrefix}${track}/`);
    }
  }

  return [...prefixes].sort();
}

function metadataAssets() {
  const records = [];

  for (const artist of manifest.artists || []) {
    for (const asset of artist.assets || []) {
      if (asset.kind === "metadata" && asset.templatePath) {
        records.push({ path: asset.storagePath, templatePath: asset.templatePath });
      }
    }
  }

  for (const single of manifest.singles || []) {
    for (const asset of single.assets || []) {
      if (asset.kind === "metadata" && asset.templatePath) {
        records.push({ path: asset.storagePath, templatePath: asset.templatePath });
      }
    }
  }

  for (const album of manifest.albums || []) {
    for (const asset of album.assets || []) {
      if (asset.kind === "metadata" && asset.templatePath) {
        records.push({ path: asset.storagePath, templatePath: asset.templatePath });
      }
    }

    for (const track of album.tracks || []) {
      const [, trackSlug] = track.match(/^(\d+)-(.+)$/) || [];
      const number = Number(track.split("-")[0]);
      records.push({
        path: `${album.storagePrefix}${track}/metadata.json`,
        generated: {
          schemaVersion: 1,
          type: "track",
          albumSlug: album.slug,
          trackSlug,
          trackNumber: number,
          title: trackSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          artist: "2MRRW",
          artistSlug: "2mrrw",
          explicit: false,
          durationSeconds: null,
          isrc: null,
          assets: {
            audio: `${album.storagePrefix}${track}/audio.mp3`,
            preview: `${album.storagePrefix}${track}/preview.mp3`,
            cover: `${album.storagePrefix}${track}/cover.jpg`,
            visual: `${album.storagePrefix}${track}/visual.mp4`,
            lyrics: `${album.storagePrefix}${track}/lyrics.lrc`,
          },
        },
      });
    }
  }

  return records;
}

async function main() {
  await uploadIfMissing(
    "metadata/digital-assets.manifest.json",
    jsonBlob(manifest),
    "application/json"
  );

  for (const prefix of collectPrefixes()) {
    await uploadIfMissing(`${prefix}.keep`, keepBlob(`Reserved folder: ${prefix}`), "text/plain");
  }

  for (const record of metadataAssets()) {
    const data = record.templatePath
      ? JSON.parse(readFileSync(record.templatePath, "utf8"))
      : record.generated;
    await uploadIfMissing(record.path, jsonBlob(data), "application/json");
  }

  console.log(`Uploaded: ${uploaded.length}`);
  for (const path of uploaded) console.log(`  + ${path}`);
  console.log(`Skipped existing: ${skipped.length}`);
  for (const path of skipped) console.log(`  = ${path}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
