import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function mediaBlock(query) {
  const start = css.indexOf(`@media ${query} {`);
  assert.ok(start > -1, query);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unterminated ${query}`);
}

// Regression: the desktop block set `.player-bar-compact { bottom: 0 }`, but
// the base rule later in the file (same specificity) re-raised the bar 62px,
// leaving an empty strip under the player on desktop.
test("the player bar docks on the bottom edge wherever the mobile bottom nav is hidden", () => {
  assert.match(css, /:root \{[\s\S]*?--bottom-nav-space: calc\(62px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  const desktop = mediaBlock("(min-width: 840px) and (hover: hover) and (pointer: fine)");
  assert.match(desktop, /\.storefront-bottom-nav \{\s*display: none !important;/);
  assert.match(desktop, /:root \{\s*--bottom-nav-space: 0px;/);
  assert.match(css, /\.player-bar-compact \{[^}]*bottom: var\(--bottom-nav-space\);/);
});

test("nothing docked above the bottom nav hard-codes its 62px height", () => {
  const offsets = [...css.matchAll(/bottom:[^;]*62px[^;]*;/g)].map((m) => m[0]);
  assert.deepEqual(offsets, [], "use var(--bottom-nav-space) so desktop drops to 0");
});
