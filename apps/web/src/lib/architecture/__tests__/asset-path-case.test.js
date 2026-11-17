import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const publicDir = path.join(root, "public");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__" && !entry.name.startsWith(".")) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const ASSET_REF = /["'`(](\/[A-Za-z0-9_\-./ %()]+?\.(?:jpe?g|png|webp|gif|svg|avif|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|woff2?|ttf|otf|ico|pdf))(?=[?"'`)#])/gi;

// Local disks here are case-insensitive, production is not: a path that differs
// from the real file only by case works on a laptop and 404s on the live site
// (/images/albums/ad.jpg vs ad.JPG broke the (A.D) cover for months).
test("every public asset path in code and migrations matches the real file's case exactly", () => {
  const files = new Set(walk(publicDir).map((file) => path.relative(publicDir, file).split(path.sep).join("/")));
  const byLowerCase = new Map([...files].map((file) => [file.toLowerCase(), file]));
  const sources = [
    ...walk(path.join(root, "src")).filter((file) => /\.(js|jsx|ts|tsx|mjs|css|json)$/.test(file)),
    ...walk(path.join(root, "supabase", "migrations")).filter((file) => file.endsWith(".sql")),
  ];

  const mismatches = [];
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(ASSET_REF)) {
      const ref = match[1].slice(1);
      const real = byLowerCase.get(ref.toLowerCase());
      if (real && real !== ref) {
        const line = text.slice(0, match.index).split("\n").length;
        mismatches.push(`${path.relative(root, file)}:${line} /${ref} (file is /${real})`);
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test("the (A.D) cover's former URL keeps resolving after the rename", () => {
  const config = fs.readFileSync(path.join(root, "next.config.mjs"), "utf8");
  assert.ok(files().has("images/albums/ad.jpg"));
  assert.match(config, /afterFiles: \[[\s\S]*?\{ source: "\/images\/albums\/ad\.JPG", destination: "\/images\/albums\/ad\.jpg" \}/);
});

function files() {
  return new Set(walk(publicDir).map((file) => path.relative(publicDir, file).split(path.sep).join("/")));
}
