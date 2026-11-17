import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { stableOrder } from "../useStableOrder.js";

const key = (item) => item.slug;
const items = (...slugs) => slugs.map((slug) => ({ slug }));
const slugs = (list) => list.map(key);

test("entries already shown keep their place when the live order changes", () => {
  // Playing w2d moves it to the front of the live history.
  assert.deepEqual(slugs(stableOrder(items("w2d", "hour-glass", "turnt"), key, ["hour-glass", "turnt", "w2d"])),
    ["hour-glass", "turnt", "w2d"]);
});

test("new entries join at the end in live order; removed entries drop out", () => {
  assert.deepEqual(slugs(stableOrder(items("new-b", "new-a", "turnt"), key, ["hour-glass", "turnt"])),
    ["turnt", "new-b", "new-a"]);
});

test("Recently Played renders the stable order, so playing never moves its cards", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../components/music/MyMusicTab.js"), "utf8");
  assert.match(src, /const shownGroups = useStableOrder\(groups, releaseGroupKey\);/);
  assert.match(src, /\{shownGroups\.map\(\(\{ key, release, coverDisplay, tracks \}, groupIdx\) => \(/);
});
