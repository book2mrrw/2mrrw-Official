/**
 * Resolve @/* imports to src/* for standalone Node test scripts.
 */
import { pathToFileURL } from "node:url";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} mappedPath */
function resolveMappedFile(mappedPath) {
  if (existsSync(mappedPath) && statSync(mappedPath).isDirectory()) {
    return pathResolve(mappedPath, "index.js");
  }
  if (existsSync(mappedPath)) return mappedPath;
  if (existsSync(`${mappedPath}.js`)) return `${mappedPath}.js`;
  if (existsSync(`${mappedPath}/index.js`)) return `${mappedPath}/index.js`;
  return mappedPath;
}

/** @param {string} specifier @param {import('node:module').ResolveHookContext} context @param {import('node:module').ResolveHook} nextResolve */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const mappedPath = resolveMappedFile(pathResolve(ROOT, "src", specifier.slice(2)));
    return nextResolve(pathToFileURL(mappedPath).href, context);
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
      const parent = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier);
      const mappedPath = resolveMappedFile(parent);
      if (mappedPath !== parent && existsSync(mappedPath)) {
        return nextResolve(pathToFileURL(mappedPath).href, context);
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
