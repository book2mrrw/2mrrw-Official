/**
 * Does VaultManager actually render?
 *
 * This exists because it once did not, and nothing caught it: `next build`
 * compiled cleanly, ESLint was silent, and every import resolved. The bug was
 * a derived value placed above the `useState` it read, so the component threw
 * `ReferenceError: Cannot access 'file' before initialization` on every single
 * render -- "something went wrong" the instant the tab was opened.
 *
 * A build proves a module parses. It does not prove a component runs. This
 * bundles the real file with its real imports and renders it, which is the
 * cheapest thing that would have caught a crash reachable on first paint.
 *
 * Only the first render is exercised: effects and event handlers are not run
 * here, so this is a smoke test for render-time faults (temporal dead zones,
 * a bad destructure, a missing import used during render), not a UI test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function renderComponent(entry, exportName) {
  const esbuild = (await import("esbuild")).default;
  const React = (await import("react")).default;
  const { renderToString } = await import("react-dom/server");

  const outfile = path.join(WEB_ROOT, `.render-check-${path.basename(entry, ".jsx")}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(WEB_ROOT, entry)],
    bundle: true,
    outfile,
    format: "esm",
    platform: "neutral",
    jsx: "automatic",
    target: "es2022",
    // Resolved from the real node_modules by the import below, not inlined.
    external: ["react", "react/jsx-runtime", "react-dom"],
    plugins: [{
      name: "next-alias",
      setup(b) {
        // Mirrors jsconfig.json's "@/*" -> "./src/*".
        b.onResolve({ filter: /^@\// }, (a) => {
          const base = path.join(WEB_ROOT, "src", a.path.slice(2));
          for (const c of [base, `${base}.js`, `${base}.jsx`, path.join(base, "index.js")]) {
            if (fs.existsSync(c) && fs.statSync(c).isFile()) return { path: c };
          }
          return { path: base };
        });
      },
    }],
  });

  try {
    const mod = await import(`${outfile}?t=${Date.now()}`);
    const Component = mod[exportName] ?? mod.default;
    assert.equal(typeof Component, "function", `${entry} does not export a component`);

    // Browser APIs the module reaches for at import/render time.
    globalThis.XMLHttpRequest ??= class { open() {} setRequestHeader() {} send() {} get upload() { return {}; } };
    // Never resolves: effects do not run under renderToString anyway, and an
    // unauthenticated stub keeps this from touching the network if that changes.
    globalThis.fetch ??= async () => ({ ok: false, status: 401, json: async () => ({}) });

    return renderToString(React.createElement(Component));
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

test("VaultManager renders without throwing", async () => {
  let html;
  try {
    html = await renderComponent("src/components/admin/VaultManager.jsx", "VaultManager");
  } catch (err) {
    assert.fail(
      `VaultManager threw on first render -- the Vault Manager tab would show ` +
      `"something went wrong":\n  ${err.constructor.name}: ${err.message}`
    );
  }
  assert.ok(html.length > 500, "rendered markup is suspiciously small");
});

test("the add form still shows its fields", () => {
  // Cheap guard on the simplified form: these are the four things it asks for,
  // and losing one silently would be easy during a layout change.
  const src = fs.readFileSync(path.join(WEB_ROOT, "src/components/admin/VaultManager.jsx"), "utf8");
  for (const field of ["vm-section", "vm-file", "vm-title", "vm-access"]) {
    assert.ok(src.includes(`"${field}"`), `the add form lost its ${field} field`);
  }
  // The slug is generated now; a hand-typed one coming back would mean the
  // simplification was undone.
  assert.ok(!src.includes('"vm-slug"'), "a manual slug field reappeared");
});
