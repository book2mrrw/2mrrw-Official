/**
 * ESM resolve hook mapping the Next.js "@/*" path alias to apps/web/src/*.
 *
 * The physical certification suite imports the REAL production modules
 * (command-dispatcher, command-executor, audio-engine-runtime, …). Those use
 * the webpack "@/" alias, which Node cannot resolve on its own. This hook
 * performs the same mapping declared in apps/web/jsconfig.json:
 *
 *   { "paths": { "@/*": ["./src/*"] } }
 *
 * Extensionless specifiers are resolved by probing the same candidate list
 * webpack uses (.js, .mjs, .jsx, /index.js) so production import statements
 * work unmodified.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

// .../apps/web/src/lib/playback-core/__tests__/physical → .../apps/web/src
const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

const CANDIDATE_SUFFIXES = ["", ".js", ".mjs", ".jsx", ".json", "/index.js", "/index.mjs"];

function resolveAliased(specifier) {
  const rel = specifier.slice(2); // strip "@/"
  const base = path.join(SRC_ROOT, rel);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

/**
 * Probe extensionless relative specifiers the way webpack does. Production
 * modules import siblings as "./audio-engine-runtime" with no extension; Node's
 * strict ESM resolver rejects that, so we resolve it against the importer.
 */
function resolveRelative(specifier, parentURL) {
  if (!parentURL || !specifier.startsWith(".")) return null;
  const parentPath = fileURLToPath(parentURL);
  const base = path.resolve(path.dirname(parentPath), specifier);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const url = resolveAliased(specifier);
    if (url) return { url, shortCircuit: true, format: "module" };
    throw new Error(
      `[alias-loader] Could not resolve "${specifier}" under ${SRC_ROOT}. ` +
      `Tried suffixes: ${CANDIDATE_SUFFIXES.join(", ")}`
    );
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const url = resolveRelative(specifier, context?.parentURL);
    if (url) return { url, shortCircuit: true, format: "module" };
    throw err;
  }
}
