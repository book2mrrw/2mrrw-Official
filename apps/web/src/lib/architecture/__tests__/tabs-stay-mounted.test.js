import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("no Home tab is mounted on demand: once opened, a tab is only ever hidden", () => {
  const home = read("src/app/HomeClient.js");
  // The old pattern rebuilt a tab's whole subtree every time it was re-opened.
  assert.doesNotMatch(home, /\{(?:\(auth\) => )?activeTab ?=== ?"[a-z-]+"(?: && isAppShell\(\))? && [(<]/);
  for (const tab of ["shop", "vault", "shows", "help", "blog", "vision", "circle", "innercircle", "account",
    "manage-releases", "manage-audio-visualz", "vault-manager"]) {
    assert.match(home, new RegExp(`<KeepAliveTab active=\\{activeTab==="${tab}"\\}>`), tab);
  }
  assert.match(home, /<KeepAliveTab active=\{activeTab==="cards" && isAppShell\(\)\}><CollectorsCardsGrid embedded \/><\/KeepAliveTab>/);
  // Home, Music and Live were already persistent.
  assert.match(home, /data-home-storefront\s+style=\{\{ display: activeTab === "home" \? undefined : "none" \}\}/);
  assert.match(home, /data-live-storefront\s+style=\{\{ display: activeTab === "live" \? undefined : "none" \}\}/);
});

test("KeepAliveTab builds on first visit, then only hides; sound stops when hidden", () => {
  const tab = read("src/components/storefront/KeepAliveTab.js");
  assert.match(tab, /const \[opened, setOpened\] = useState\(active\);\s*if \(active && !opened\) setOpened\(true\);/);
  assert.match(tab, /if \(!opened && !active\) return null;/);
  assert.match(tab, /<div ref=\{panelRef\} hidden=\{!active\} aria-hidden=\{!active\}>/);
  assert.match(tab, /if \(!media\.paused && !media\.muted\) media\.pause\(\);/);
  assert.doesNotMatch(tab, /key=/, "no key that could force a remount");
});
