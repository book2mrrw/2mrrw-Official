import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

const browse = read("src/app/api/audio-visual/browse/route.js");
const seriezDetail = read("src/app/api/audio-visual/seriez/[id]/route.js");

test("browse is a public route — no admin/session guard, matching the confirmed rule that peek-level browsing needs no auth", () => {
  assert.doesNotMatch(browse, /getAdminSessionUser|getFanSessionUser|requireAdminActor/);
  assert.match(browse, /checkRateLimit/);
});

test("browse never performs a per-item entitlement check — that stays exclusively in the manifest/key routes, never duplicated here", () => {
  // The doc comment legitimately references userCanWatchAudioVisual by name
  // for context — check for a real import/call, not the bare string.
  assert.doesNotMatch(browse, /from\s+["']@\/lib\/audio-visual\/entitlements["']/);
  assert.doesNotMatch(browse, /userCanWatchAudioVisual\(/);
});

test("standalone (non-seriez) queries only ever return published rows with no Seriez attachment, never an episode duplicated into the flat grid", () => {
  const at = browse.indexOf('let query = admin');
  const body = browse.slice(at, at + 400);
  assert.match(body, /\.eq\("publication_state", "published"\)/);
  assert.match(body, /\.is\("seriez_id", null\)/);
});

test("the seriez pseudo-filter only surfaces a Seriez once it has at least one published episode — an all-draft shell stays admin-only", () => {
  const at = browse.indexOf('if (type === "seriez")');
  const body = browse.slice(at, at + 700);
  assert.match(body, /\.eq\("publication_state", "published"\)/);
  assert.match(body, /\.not\("seriez_id", "is", null\)/);
});

test("seriez detail is also a public route with no admin/session guard", () => {
  assert.doesNotMatch(seriezDetail, /getAdminSessionUser|getFanSessionUser|requireAdminActor/);
  assert.match(seriezDetail, /checkRateLimit/);
});

test("seriez detail delegates the release-cadence visibility rule to the shared, independently-tested resolveVisibleEpisodes function rather than reimplementing it inline", () => {
  assert.match(seriezDetail, /import \{ resolveVisibleEpisodes \} from "@\/lib\/audio-visual\/seriez-cadence"/);
  assert.match(seriezDetail, /resolveVisibleEpisodes\(episodes, Date\.now\(\), getPublicR2Url\)/);
});

test("episodes are always ordered by season then episode number, never an ambiguous order", () => {
  assert.match(seriezDetail, /\.order\("season_number", \{ ascending: true \}\)/);
  assert.match(seriezDetail, /\.order\("episode_number", \{ ascending: true \}\)/);
});
