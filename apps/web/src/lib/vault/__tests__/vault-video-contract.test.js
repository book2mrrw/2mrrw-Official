/**
 * Vault video lane contract.
 *
 * The important cases here are the seams: the ladder is hand-duplicated into
 * the worker (separate deployable, no shared module path), and the bitrate
 * strings are an interface with the master-playlist route, which silently
 * drops any rung it cannot map to a BANDWIDTH. Both are the kind of agreement
 * that breaks quietly, so both are asserted rather than trusted.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  VAULT_VIDEO_LADDER,
  VAULT_VIDEO_RENDITIONS,
  VAULT_VIDEO_SEGMENT_SECONDS,
  buildVaultVideoHlsPrefix,
  ladderForSourceHeight,
} from "../vault-video-contract.js";

import {
  LADDER as WORKER_LADDER,
  SEGMENT_SECONDS as WORKER_SEGMENT_SECONDS,
  ladderForSourceHeight as workerLadderForSourceHeight,
} from "../../../../workers/hls-transcoder/src/vault-video-ladder.js";

/* --- the hand-synced seam --------------------------------------------- */

test("the worker's ladder is identical to the app's", () => {
  assert.deepEqual(
    WORKER_LADDER.map((r) => ({ ...r })),
    VAULT_VIDEO_LADDER.map((r) => ({ ...r })),
    "worker and app ladders have drifted -- the worker would encode rungs the playlist cannot advertise"
  );
  assert.equal(WORKER_SEGMENT_SECONDS, VAULT_VIDEO_SEGMENT_SECONDS);
});

test("both ladders choose the same rungs for every plausible source height", () => {
  for (const h of [0, 144, 240, 360, 480, 540, 576, 720, 900, 1080, 1440, 2160, 4320, 481, 721]) {
    assert.deepEqual(
      workerLadderForSourceHeight(h),
      ladderForSourceHeight(h),
      `ladders disagree for a ${h}px source`
    );
  }
});

/* --- the interface with the master playlist ----------------------------- */

test("every rung is one the vault video manifest route can map to a bandwidth", () => {
  // /api/vault/video/manifest's BITRATE_BANDWIDTH table. A rung missing from
  // it is dropped from the master playlist, so it would be encoded, uploaded,
  // paid for, and never played.
  const ROUTE_KNOWS = new Set(["4000k", "2000k", "1000k", "720k", "320k", "160k", "96k"]);
  for (const b of VAULT_VIDEO_RENDITIONS) {
    assert.ok(ROUTE_KNOWS.has(b), `rung ${b} is not in the manifest route's bandwidth table`);
  }
});

/* --- ladder behaviour --------------------------------------------------- */

test("no rung ever upscales above the source", () => {
  for (const h of [144, 240, 360, 480, 540, 576, 720, 900, 1080, 2160]) {
    for (const r of ladderForSourceHeight(h)) {
      assert.ok(r.encodeHeight <= h, `${r.bitrate} encodes ${r.encodeHeight}p from a ${h}p source`);
    }
  }
});

test("a source between rungs still gets a near-native top rung", () => {
  // The whole point of not simply truncating: a 480p phone clip would
  // otherwise stream at 360p, below what was shot.
  const l = ladderForSourceHeight(480);
  assert.equal(l[0].encodeHeight, 480);
  assert.ok(l.length > 1, "should still carry a smaller rung underneath");
});

test("a source sitting exactly on a rung is not encoded twice at one height", () => {
  for (const h of [1080, 720, 540, 360]) {
    const heights = ladderForSourceHeight(h).map((r) => r.encodeHeight);
    assert.equal(new Set(heights).size, heights.length, `duplicate heights for a ${h}p source`);
  }
});

test("even the smallest source gets a playable rung, at an even height", () => {
  for (const h of [120, 144, 241, 99]) {
    const l = ladderForSourceHeight(h);
    assert.ok(l.length >= 1, `no rung for a ${h}p source`);
    for (const r of l) {
      assert.equal(r.encodeHeight % 2, 0, `h.264 needs even dimensions; got ${r.encodeHeight}`);
    }
  }
});

/* --- storage identity --------------------------------------------------- */

test("output lands in the vault tree, never a release tree", () => {
  const prefix = buildVaultVideoHlsPrefix({ category: "Live Replayz", slug: "the-last-show" });
  assert.equal(prefix, "hls/vault/live-replayz/the-last-show/");
  for (const rt of ["singles", "features", "albums", "mixtapes-and-eps"]) {
    assert.ok(!prefix.startsWith(`hls/${rt}/`));
  }
});

test("a traversal attempt or unknown section produces no prefix at all", () => {
  for (const slug of ["../escape", "a/b", "UPPER", "", "-lead"]) {
    assert.equal(buildVaultVideoHlsPrefix({ category: "Live Replayz", slug }), null);
  }
  assert.equal(buildVaultVideoHlsPrefix({ category: "Not A Section", slug: "ok" }), null);
});
