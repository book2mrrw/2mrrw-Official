#!/usr/bin/env node

export function parseFlags(argv) {
  const flags = new Set();
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return {
    dryRun: flags.has("--dry-run"),
    force: flags.has("--force"),
    deploy: flags.has("--deploy"),
    skipGit: flags.has("--skip-git"),
    skipBuild: flags.has("--skip-build"),
    skipInstall: flags.has("--skip-install"),
    quick: flags.has("--quick"),
    restoreLockfiles: flags.has("--restore-lockfiles") || !flags.has("--no-restore-lockfiles"),
    positional,
    has: (name) => flags.has(name),
  };
}

export function warnForce(message) {
  console.warn("");
  console.warn("⚠️  FORCE MODE — destructive git operations enabled");
  console.warn(`   ${message}`);
  console.warn("");
}
