import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

// A vertical scroller with overflow-x left unset scrolls sideways as soon as
// anything inside is a pixel too wide (CSS turns the visible axis into auto),
// and then dragging a scrubber drags the whole sheet instead.
const verticalScrollers = (source) =>
  [...source.matchAll(/style=\{\{([^{}]*?overflowY\s*:\s*"(?:auto|scroll)"[^{}]*?)\}\}/g)].map((m) => m[1]);

test("every vertical scroller inside a modal or sheet blocks sideways scrolling", () => {
  for (const file of [
    "src/components/preview/ImmersivePreviewModal.js",
    "src/components/gifts/GiftBottomSheet.js",
    "src/components/audio/GlobalAudioPlayerBar.js",
  ]) {
    for (const style of verticalScrollers(read(file))) {
      assert.match(style, /overflowX\s*:\s*"hidden"/, `${file}: ${style.slice(0, 80)}`);
    }
  }
  // HomeClient: the mobile navigation sheets (the desktop sidebar is not a sheet).
  const sheets = verticalScrollers(read("src/app/HomeClient.js")).filter((style) => style.includes('borderRadius:"20px 20px 0 0"'));
  assert.ok(sheets.length >= 2);
  for (const style of sheets) assert.match(style, /overflowX:"hidden"/);
});

test("every modal scroll class in the stylesheet blocks sideways scrolling", () => {
  const css = read("src/app/globals.css");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const name of [
    ".storefront-adaptive-modal-overlay", ".storefront-adaptive-modal-panel", ".modal-immersive-panel--mobile",
    ".modal-immersive-drawer", ".modal-immersive-panel--scroll", ".vault-door-gate__frame-screen",
    ".player-immersive-expanded", ".auth-card", ".modal-immersive-info-zone",
  ]) {
    const scrolling = rules.filter(([, selector, body]) => selector.includes(name) && /overflow(-y)?\s*:\s*(auto|scroll)/.test(body));
    assert.ok(scrolling.length > 0, name);
    for (const [, , body] of scrolling) assert.match(body, /overflow-x:\s*hidden/, name);
  }
});

test("the modal scrubber fits its row, is a finger tall to grab, and owns the drag", () => {
  const src = read("src/components/preview/ImmersivePreviewModal.js");
  const start = src.indexOf("function ScrubBar(");
  const body = src.slice(start, src.indexOf("function EditorialActions(", start));
  // Shrinks between the time labels instead of pushing them off the screen.
  assert.match(body, /flex: "1 1 0%",\s*minWidth: 0,/);
  assert.doesNotMatch(body, /flexShrink: 0/);
  // 4px track inside a 44px target.
  assert.match(src, /const SCRUB_HIT_PAD_PX = 20;/);
  assert.match(body, /padding: `\$\{SCRUB_HIT_PAD_PX\}px 0`,\s*margin: `-\$\{SCRUB_HIT_PAD_PX\}px 0`,/);
  assert.match(body, /<div\s+ref=\{barRef\}\s+style=\{\{\s*height: 4,/);
  // React's touchmove listeners are passive, so preventDefault cannot stop a
  // pan; touch-action can.
  assert.match(body, /touchAction: isPreview \? "auto" : "none",/);
});

test("the vault audio scrubber is silent while dragging and seeks once, on release", () => {
  const src = read("src/components/vault/VaultAudioTransport.jsx");
  const follow = src.slice(src.indexOf("const followScrub"), src.indexOf("const commitScrub"));
  assert.doesNotMatch(follow, /currentTime/, "following the finger never seeks");
  assert.match(src, /onChange=\{followScrub\}\s*onPointerUp=\{commitScrub\}\s*onTouchEnd=\{commitScrub\}\s*onKeyUp=\{commitScrub\}\s*onBlur=\{commitScrub\}/);
  const css = read("src/app/globals.css");
  const seek = css.slice(css.indexOf(".vault-audio-transport__seek {"), css.indexOf("}", css.indexOf(".vault-audio-transport__seek {")));
  assert.match(seek, /height: 24px;/);
  assert.match(seek, /touch-action: none;/);
});
