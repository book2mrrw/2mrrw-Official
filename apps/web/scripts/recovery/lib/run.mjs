#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { ROOT } from "./anchor.mjs";

export function run(cmd, args, { dryRun = false, label = cmd } = {}) {
  const display = [cmd, ...args].join(" ");
  if (dryRun) {
    console.log(`[dry-run] ${label}: ${display}`);
    return { status: 0, dryRun: true };
  }
  console.log(`\n→ ${label}: ${display}\n`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${display}`);
  }
  return result;
}

export function git(args, opts = {}) {
  return run("git", args, { label: "git", ...opts });
}

export function npmScript(script, opts = {}) {
  return run("npm", ["run", script], { label: `npm run ${script}`, ...opts });
}

export function npmCi(opts = {}) {
  return run("npm", ["ci"], { label: "npm ci", ...opts });
}
