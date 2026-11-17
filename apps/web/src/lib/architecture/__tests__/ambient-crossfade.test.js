import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const src = fs.readFileSync(path.join(root, "src/components/home/AmbientPlaybackBackground.js"), "utf8").replace(/\r\n/g, "\n");
const layer = src.slice(src.indexOf("function AmbientVideoLayer("), src.indexOf("export default function AmbientPlaybackBackground("));

test("the ambient on screen is never unloaded when a track starts", () => {
  // Startup only defers loading the NEXT track's ambient; the current layer keeps showing.
  const startupGuards = [...layer.matchAll(/if \(audioPriority\.startupActive\) return undefined;/g)].length;
  assert.equal(startupGuards, 2, "first load and next-track load wait for the startup lease");
  const beforeSwap = layer.slice(0, layer.indexOf("const swap = () => {"));
  assert.doesNotMatch(beforeSwap, /current\.removeAttribute\("src"\)/, "the visible layer is not unloaded before the swap");
  assert.match(layer, /\/\/ A new track: the current ambient stays on screen while the next loads\.\s*show\(current\);/);
});

test("tracks cross-fade between two persistent layers once the next has a frame", () => {
  assert.match(layer, /if \(next\.readyState >= 2\) \{ swap\(\); return undefined; \}/);
  assert.match(layer, /next\.addEventListener\("loadeddata", swap, \{ once: true \}\);/);
  const swap = layer.slice(layer.indexOf("const swap = () => {"), layer.indexOf("if (next.readyState >= 2)"));
  assert.match(swap, /show\(next\);\s*pause\(current\);/, "one starts as the other pauses: decoder budget unchanged");
  assert.match(swap, /setTimeout\(\(\) => \{\s*current\.removeAttribute\("src"\);/, "the old layer is freed only after it has faded out");
  assert.equal((layer.match(/<video/g) || []).length, 2);
  assert.doesNotMatch(layer, /key=/, "no key that could remount a layer");
});
