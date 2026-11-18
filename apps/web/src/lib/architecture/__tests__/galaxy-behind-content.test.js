import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

// Regression: at z-index 0 the fixed galaxy painted over every page that does
// not lift its content (only Home's shell does) — on Android the sign-in form
// was invisible under the starfield.
test("the galaxy sits beneath all page content, and the ambient backdrop beneath the galaxy", () => {
  assert.match(read("src/components/environment/environment.css"), /\.galaxy-environment \{[^}]*z-index: -1;/);
  const ambient = read("src/components/home/AmbientPlaybackBackground.js");
  assert.equal((ambient.match(/zIndex: -2,/g) || []).length, 2);
  assert.doesNotMatch(ambient, /zIndex: -1,/);
});

test("a negative z-index stays visible: <html> paints no background of its own", () => {
  // The body's background must propagate to the canvas; if <html> had its own
  // background, the body would paint over the galaxy everywhere.
  const css = read("src/app/globals.css");
  assert.doesNotMatch(css, /(^|\n)\s*html\s*(,[^{]*)?\{[^}]*background/);
  assert.doesNotMatch(read("src/app/layout.js"), /<html[^>]*style=/);
});
