#!/usr/bin/env node
/**
 * Load canonical recovery anchor from docs/foundation/recovery-anchor.json
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "../../..");
export const ANCHOR_PATH = join(ROOT, "docs/foundation/recovery-anchor.json");

export function loadAnchor() {
  if (!existsSync(ANCHOR_PATH)) {
    throw new Error(`Missing recovery anchor: ${ANCHOR_PATH}`);
  }
  return JSON.parse(readFileSync(ANCHOR_PATH, "utf8"));
}

export function anchorCommit(anchor = loadAnchor()) {
  const commit = anchor?.commit;
  if (!commit || typeof commit !== "string") {
    throw new Error("recovery-anchor.json: missing or invalid commit");
  }
  return commit.trim();
}

export function anchorBranch(anchor = loadAnchor()) {
  return anchor?.branch || "frontend-stable-foundation";
}
