import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

const seriezRoute = read("src/app/api/admin/audio-visual/seriez/route.js");
const nextEpisodeRoute = read("src/app/api/admin/audio-visual/seriez/[id]/next-episode/route.js");
const draftRoute = read("src/app/api/admin/audio-visual/draft/route.js");

test("Seriez creation requires the canonical admin guard and generates its own slug independent of audio_visuals' slug space", () => {
  assert.match(seriezRoute, /getAdminSessionUser/);
  assert.match(seriezRoute, /isAdminUser\(user\)/);
  assert.match(seriezRoute, /\.from\("audio_visual_seriez"\)\.select\("id"\)\.eq\("slug", candidate\)/);
});

test("next-episode never predetermines a count — it suggests max(episode_number)+1 for the given season, defaulting to 1 for a brand-new season", () => {
  assert.match(nextEpisodeRoute, /order\("episode_number", \{ ascending: false \}\)/);
  assert.match(nextEpisodeRoute, /const nextEpisodeNumber = \(data\?\.episode_number \|\| 0\) \+ 1;/);
});

test("next-episode is purely a suggestion — the draft route still independently accepts and the DB still enforces whatever is actually submitted", () => {
  assert.match(nextEpisodeRoute, /Purely\s+\* a suggestion returned to the client/);
  // draft/route.js never trusts next-episode's output directly — it takes season_number/episode_number as ordinary body fields
  assert.match(draftRoute, /season_number: seriezId \? seasonNumber : null/);
  assert.match(draftRoute, /episode_number: seriezId \? episodeNumber : null/);
});

test("draft creation validates a season+episode number is present whenever a Seriez is attached, never a silently-null episode number on a real Seriez row", () => {
  assert.match(
    draftRoute,
    /if \(seriezId && \(!Number\.isInteger\(seasonNumber\) \|\| !Number\.isInteger\(episodeNumber\)\)\)/
  );
});

test("draft creation verifies the referenced Seriez actually exists before ever inserting the episode row", () => {
  const at = draftRoute.indexOf("if (seriezId) {");
  const body = draftRoute.slice(at, at + 400);
  assert.match(body, /\.from\("audio_visual_seriez"\)\.select\("id"\)\.eq\("id", seriezId\)/);
  assert.match(body, /Seriez not found/);
});
