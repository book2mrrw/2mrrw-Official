#!/usr/bin/env node
/**
 * Lightweight scan for patterns that risk the official frontend foundation baseline.
 * Does not modify source files.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const issues = [];

function add(severity, file, message) {
  issues.push({ severity, file, message });
}

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function scanPackageJson() {
  const pkg = JSON.parse(read("package.json"));
  const ranges = [];
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section] || {};
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === "string" && /^[\^~]/.test(version)) {
        ranges.push(`${section}.${name}@${version}`);
      }
    }
  }
  if (ranges.length) {
    add(
      "error",
      "package.json",
      `Unpinned dependency ranges detected: ${ranges.join(", ")}`
    );
  }
}

function scanPageJs() {
  const path = "src/app/page.js";
  if (!existsSync(join(ROOT, path))) {
    add("error", path, "Missing primary cinematic page — foundation broken.");
    return;
  }
  const source = read(path);
  const requiredMarkers = [
    ['"use client"', "client boundary"],
    ["framer-motion", "motion system"],
    ["useReducedMotion", "reduced-motion accessibility guard"],
    ['data-cinematic-video="true"', "cinematic video marker"],
    ["ReleaseArtwork", "release artwork component"],
  ];
  for (const [marker, label] of requiredMarkers) {
    if (!source.includes(marker)) {
      add("warn", path, `Expected foundation marker missing: ${label} (${marker})`);
    }
  }
  const risky = [
    [/dangerouslySetInnerHTML/g, "dangerouslySetInnerHTML"],
    [/localStorage\.setItem\([^)]*entitlement/gi, "client-side entitlement mutation"],
    [/permissions\s*=\s*\{[^}]*vault:\s*true/gi, "hardcoded vault permission"],
  ];
  for (const [pattern, label] of risky) {
    if (pattern.test(source)) {
      add("warn", path, `Risky pattern detected: ${label}`);
    }
  }
}

function scanAuthContext() {
  const path = "src/context/AuthContext.js";
  const source = read(path);
  const hydrationMarkers = ["/api/account/state", "/api/library", "/api/guest/session"];
  if (!hydrationMarkers.some((marker) => source.includes(marker))) {
    add(
      "error",
      path,
      "Account state must hydrate from server API (/api/account/state, /api/library, or /api/guest/session)."
    );
  }
  if (/setPermissions\(\{[^}]*vault:\s*true/i.test(source)) {
    add("warn", path, "Possible UI-side vault permission override.");
  }
}

function scanLayout() {
  const path = "src/app/layout.js";
  const source = read(path);
  for (const provider of ["AuthProvider", "StripeProvider"]) {
    if (!source.includes(provider)) {
      add("error", path, `Missing root provider: ${provider}`);
    }
  }
  if (!source.includes("AudioProvider")) {
    add(
      "warn",
      path,
      "AudioProvider not in root layout (acceptable if audio mounts in page shell)."
    );
  }
}

function scanFoundationDocs() {
  const required = [
    "docs/foundation/FRONTEND_FOUNDATION_BASELINE.md",
    "docs/foundation/FRONTEND_RECOVERY_ANCHOR.md",
    "docs/foundation/FRONTEND_RECOVERY_PROTOCOL.md",
    "docs/foundation/FRONTEND_ARCHITECTURAL_GUARDRAILS.md",
  ];
  for (const doc of required) {
    if (!existsSync(join(ROOT, doc))) {
      add("error", doc, "Missing foundation documentation.");
    }
  }
}

try {
  scanPackageJson();
  scanFoundationDocs();
  scanLayout();
  scanAuthContext();
  scanPageJs();
} catch (err) {
  add("error", "scripts/check-frontend-guardrails.mjs", err.message);
}

const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warn");

for (const item of issues) {
  const prefix = item.severity.toUpperCase();
  const file = relative(ROOT, join(ROOT, item.file));
  console.log(`${prefix} ${file}: ${item.message}`);
}

console.log("");
console.log(
  `Frontend guardrails: ${errors.length} error(s), ${warnings.length} warning(s).`
);

if (errors.length > 0) process.exit(1);
