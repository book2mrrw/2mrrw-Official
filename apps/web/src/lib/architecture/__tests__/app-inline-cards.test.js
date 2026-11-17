import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { isAppShell } from "../../platform/app-shell.js";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("isAppShell is false on the website and true only when the app sets its flag", () => {
  delete globalThis.__2MRRW_APP_SHELL__;
  assert.equal(isAppShell(), false);
  globalThis.__2MRRW_APP_SHELL__ = "yes";
  assert.equal(isAppShell(), false, "only the exact flag counts");
  globalThis.__2MRRW_APP_SHELL__ = true;
  assert.equal(isAppShell(), true);
  delete globalThis.__2MRRW_APP_SHELL__;
});

test("the website still opens Collector's Cards on its own page; only the app renders them inline", () => {
  const home = read("src/app/HomeClient.js");
  assert.match(home, /if \(tabId === "cards" && !isAppShell\(\)\) \{\s*router\.push\(COLLECTORS_CARDS_ROUTE\);\s*return;/);
  assert.match(home, /\{activeTab==="cards" && isAppShell\(\) && <CollectorsCardsGrid embedded \/>\}/);
  assert.match(home, /window\.addEventListener\("2mrrw:open-tab", onOpenTab\)/);
});

test("the embedded grid leaves page chrome to Home: no wordmark header, page background, or back link", () => {
  const grid = read("src/components/collectors-cards/CollectorsCardsGrid.js");
  assert.match(grid, /export function CollectorsCardsGrid\(\{ embedded = false \} = \{\}\)/);
  assert.match(grid, /\{embedded \? null : <div style=\{\{ textAlign: "center", marginTop: 36 \}\}>\s*<Link/);
  assert.match(grid, /\{embedded \? null : \(\s*<div/);
  assert.match(grid, /style=\{embedded \? \{/);
});
