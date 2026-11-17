import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("no Home tab is mounted on demand: once built, a tab is only ever hidden", () => {
  const home = read("src/app/HomeClient.js");
  // The old pattern rebuilt a tab's whole subtree every time it was re-opened.
  assert.doesNotMatch(home, /\{(?:\(auth\) => )?activeTab ?=== ?"[a-z-]+"(?: && isAppShell\(\))? && [(<]/);
  for (const tab of ["shop", "vault", "shows", "help", "blog", "vision", "circle", "innercircle", "account"]) {
    assert.match(home, new RegExp(`<KeepAliveTab active=\\{activeTab==="${tab}"\\}>`), tab);
  }
  // Admin tools are built when opened, never ahead of time.
  for (const tab of ["manage-releases", "manage-audio-visualz", "vault-manager"]) {
    assert.match(home, new RegExp(`<KeepAliveTab active=\\{activeTab==="${tab}"\\} prebuild=\\{false\\}>`), tab);
  }
  assert.match(home, /<KeepAliveTab active=\{activeTab==="cards" && isAppShell\(\)\} prebuild=\{isAppShell\(\)\}><CollectorsCardsGrid embedded \/><\/KeepAliveTab>/);
  // Home and Music are always mounted panels; Live keeps its own persistent div.
  assert.match(home, /<TabPanel data-home-storefront active=\{activeTab === "home"\}>/);
  assert.match(home, /<TabPanel active=\{MUSIC_TAB_IDS\.has\(activeTab\)\}>/);
  assert.match(home, /data-live-storefront\s+style=\{\{ display: activeTab === "live" \? undefined : "none" \}\}/);

  const music = read("src/components/storefront/MusicTabCatalogPanels.js");
  for (const tab of ["singles", "albums", "mixtapes", "mymusic"]) {
    assert.match(music, new RegExp(`<TabPanel as="section" active=\\{activeTab === "${tab}"\\}>`), tab);
  }
  assert.doesNotMatch(music, /<section hidden=/);
});

test("a hidden panel keeps its rendering state: content-visibility, never display:none or remounting", () => {
  const tab = read("src/components/storefront/KeepAliveTab.js");
  assert.match(tab, /const HIDDEN_CLASS = "tab-panel-hidden";/);
  assert.match(tab, /className=\{active \? className : \[className, HIDDEN_CLASS\]\.filter\(Boolean\)\.join\(" "\)\}/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.tab-panel-hidden \{\n  content-visibility: hidden;\n\}/);
  // Browsers without content-visibility must still hide the tab.
  assert.match(css, /@supports not \(content-visibility: hidden\) \{\n  \.tab-panel-hidden \{\n    display: none;/);
  assert.match(tab, /inert=\{!active\}/, "React 19 inert is boolean; an empty string would drop it");
  assert.doesNotMatch(tab, /[^-]hidden=\{|display: ?"none"/);
  assert.doesNotMatch(tab, /key=/, "no key that could force a remount");
  assert.match(tab, /if \(!media\.paused && !media\.muted\) media\.pause\(\);/);
  // Shown as it already is: one-shot animations created while hidden finish
  // before the first paint (Chromium never runs them in a hidden subtree).
  assert.match(tab, /if \(!wasActive\) \{\s*panel\.getAnimations\?\.\(\{ subtree: true \}\)\.forEach\(\(animation\) => \{\s*if \(Number\.isFinite\(animation\.effect\?\.getComputedTiming\(\)\.endTime\)\) animation\.finish\(\);/);
  assert.match(tab, /if \(lazy && !shown && !prepared\) return null;/);
});

test("being prepared re-renders nothing that is already built", () => {
  const tab = read("src/components/storefront/KeepAliveTab.js");
  // Only a lazy panel subscribes (that render is its first build).
  assert.match(tab, /useSyncExternalStore\(lazy \? handle\.subscribe : noSubscribe, lazy \? handle\.isPrepared : notPrepared, notPrepared\)/);

  const hook = read("src/hooks/usePanelLoadAhead.js");
  assert.doesNotMatch(hook, /useState|useSyncExternalStore|useReducer/, "load-ahead drives media directly, never through state");

  for (const file of [
    "src/components/ui/CoverArt.js",
    "src/ui/skeletons/ArtworkSkeleton.js",
    "src/components/home/LatestSinglesStyleRow.js",
    "src/components/home/MerchProductCard.js",
  ]) {
    const source = read(file);
    assert.match(source, /usePanelLoadAhead\(/, file);
    assert.doesNotMatch(source, /const loadAhead = usePanelLoadAhead\(\)/, `${file}: the prepared flag is never read as render state`);
  }
});

test("a cover loads ahead once per source and never plays while unseen", () => {
  for (const file of ["src/components/ui/CoverArt.js", "src/ui/skeletons/ArtworkSkeleton.js"]) {
    const source = read(file);
    const loadAheadNow = source.slice(source.indexOf("const loadAheadNow = () => {"), source.indexOf("const loadAheadRef = usePanelLoadAhead(loadAheadNow);"));
    assert.match(loadAheadNow, /loadAheadSrcRef\.current === el\.src\) return;/, file);
    assert.doesNotMatch(loadAheadNow, /\.play\(|requestPlay/, `${file}: loading ahead never plays`);
    // Coming into view never restarts a load that is already under way.
    assert.match(source, /if \(el\.readyState === 0 && el\.src && loadAheadSrcRef\.current !== el\.src\) el\.load\(\);/, file);
    assert.match(source, /if \(!loadAheadRef\.current\) el\.preload = "none";/, file);
  }
  const row = read("src/components/home/LatestSinglesStyleRow.js");
  assert.match(row, /if \(hasEnteredView && !document\.hidden && el\.paused\) el\.play\(\)/);
});

test("the Vault state never re-renders the page: it lives in its own store, read only by the Vault tabs", () => {
  const home = read("src/app/HomeClient.js");
  assert.doesNotMatch(home, /\[publicVault, setPublicVault\]/);
  assert.equal((home.match(/<PublicVaultIsland>\{\(publicVault\) =>/g) || []).length, 2);
  assert.match(home, /if \(activeTab === "innercircle" \|\| activeTab === "vault"\) void loadPublicVault\(\);/);
});
