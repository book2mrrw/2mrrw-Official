#!/usr/bin/env node
/**
 * Phase 5.2.3 — static title validation for album queue objects.
 * Run: node --import ./scripts/register-alias.mjs .tmp-phase523-metadata-remediation-20260530/validate-metadata.mjs
 */
import assert from "node:assert/strict";
import { getCanonicalTracksForAlbum } from "@/lib/media/canonical-catalog.js";
import {
  mapAlbumTracksForPlayback,
  playableReleaseQueue,
  resolveReleaseQueueStartIndex,
} from "@/lib/music-playback.js";

const accountState = { subscriberActive: true, userId: "phase523" };
const catalogLookup = { bySlug: new Map(), byTitle: new Map() };

const RELEASES = [
  { slug: "love-hz-vol-1", taps: [0, 2, 4, 6, 9] },
  { slug: "ad", taps: [0, 2, 4, 6, 10] },
  { slug: "tbh", taps: [0, 2, 4, 6, 8] },
];

for (const { slug, taps } of RELEASES) {
  const canonical = getCanonicalTracksForAlbum(slug);
  const tracks = canonical.map((t, i) => ({
    slug: t.slug,
    title: t.title,
    id: t.slug,
    src: "/phase523-test.mp3",
    trackIndex: i,
  }));
  const album = { slug, title: slug, tracks, release_type: slug === "love-hz-vol-1" ? "ep" : "mixtape" };
  const queue = mapAlbumTracksForPlayback(album, accountState, "album", catalogLookup);
  const playable = playableReleaseQueue(queue, accountState);

  for (const releaseIdx of taps) {
    const expectedTitle = canonical[releaseIdx]?.title;
    const item = queue[releaseIdx];
    assert.equal(
      item.title,
      expectedTitle,
      `${slug} track ${releaseIdx + 1}: expected "${expectedTitle}", got "${item.title}"`
    );
    const qIdx = resolveReleaseQueueStartIndex(playable, releaseIdx);
    assert.equal(
      playable[qIdx]?.title,
      expectedTitle,
      `${slug} playable queue at release index ${releaseIdx}`
    );
  }
}

console.log("PASS phase523 metadata title validation (tracks 1/3/5/7/last)");
