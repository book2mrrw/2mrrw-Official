import assert from "node:assert/strict";
import test from "node:test";
import { resolveVisibleEpisodes } from "../seriez-cadence.js";

const NOW = new Date("2026-09-10T00:00:00Z").getTime();

function episode(overrides = {}) {
  return {
    id: "ep-1", slug: "ep-1", title: "Episode", video_type: "podcast",
    publication_state: "draft", scheduled_at: null,
    season_number: 1, episode_number: 1, poster_r2_key: null,
    ...overrides,
  };
}

test("a published episode is always visible and playable, regardless of any scheduled_at value", () => {
  const [result] = resolveVisibleEpisodes([episode({ publication_state: "published" })], NOW);
  assert.equal(result.status, "playable");
  assert.equal(result.scheduled_at, null);
});

test("an unpublished episode with a real FUTURE scheduled_at is visible as upcoming, with that real date shown", () => {
  const future = new Date(NOW + 7 * 24 * 3600 * 1000).toISOString();
  const [result] = resolveVisibleEpisodes([episode({ publication_state: "ready", scheduled_at: future })], NOW);
  assert.equal(result.status, "upcoming");
  assert.equal(result.scheduled_at, future);
});

test("an unpublished episode whose scheduled_at has already passed is excluded — it's overdue, not a confusing 'upcoming' promise", () => {
  const past = new Date(NOW - 3600 * 1000).toISOString();
  const results = resolveVisibleEpisodes([episode({ publication_state: "ready", scheduled_at: past })], NOW);
  assert.equal(results.length, 0);
});

test("an episode with no schedule at all (draft/processing/ready-unscheduled/failed/unpublished) is excluded entirely — never a vague placeholder", () => {
  for (const state of ["draft", "processing", "ready", "failed", "unpublished"]) {
    const results = resolveVisibleEpisodes([episode({ publication_state: state, scheduled_at: null })], NOW);
    assert.equal(results.length, 0, `${state} with no schedule must be excluded`);
  }
});

test("a mixed list correctly separates playable, upcoming, and hidden episodes in one pass", () => {
  const future = new Date(NOW + 86400000).toISOString();
  const list = [
    episode({ id: "e1", episode_number: 1, publication_state: "published" }),
    episode({ id: "e2", episode_number: 2, publication_state: "ready", scheduled_at: future }),
    episode({ id: "e3", episode_number: 3, publication_state: "draft" }),
  ];
  const results = resolveVisibleEpisodes(list, NOW);
  assert.deepEqual(results.map((r) => r.video_id), ["e1", "e2"]);
  assert.equal(results[0].status, "playable");
  assert.equal(results[1].status, "upcoming");
});

test("poster_url is resolved through the injected urlFn only when a poster_r2_key exists, never a broken URL from a null key", () => {
  const calls = [];
  const urlFn = (key) => { calls.push(key); return `https://cdn.example/${key}`; };
  const results = resolveVisibleEpisodes(
    [episode({ publication_state: "published", poster_r2_key: "posters/ep-1.jpg" }), episode({ id: "ep-2", publication_state: "published", poster_r2_key: null })],
    NOW, urlFn
  );
  assert.equal(results[0].poster_url, "https://cdn.example/posters/ep-1.jpg");
  assert.equal(results[1].poster_url, null);
  assert.deepEqual(calls, ["posters/ep-1.jpg"]);
});

test("an empty or missing episode list resolves to an empty array, never throwing", () => {
  assert.deepEqual(resolveVisibleEpisodes([], NOW), []);
  assert.deepEqual(resolveVisibleEpisodes(null, NOW), []);
  assert.deepEqual(resolveVisibleEpisodes(undefined, NOW), []);
});
