import assert from "node:assert/strict";
import test from "node:test";

import { mapProductRow } from "@/lib/media/catalog-db";
import { isStillUrl } from "@/lib/media/cover-descriptor";
import { withR2CatalogMedia } from "@/lib/media/r2-catalog-media";

/**
 * Every release created through the upload manager was rendering no cover at all.
 *
 * The rows are not at fault — they carry the correct artwork. The publish path
 * writes a `/api/media/visual?...` DISCOVERY URL into `cover_url`, and the real
 * static key sits in `metadata.cover_art_r2_key`. mapProductRow derived its still
 * from `cover_url` and never read `cover_art_r2_key` for anything but a revision
 * string, so the still slot received a discovery URL. resolveCoverDescriptor
 * correctly refuses that as a still (the endpoint prefers VIDEO — the wrong answer
 * for an <img>), which left baseCover null: an <img> with no src.
 *
 * These are the exact shapes observed in production on 2026-09-30.
 */

/** all-yourz — a single uploaded through the upload manager. */
const UPLOADED_SINGLE = Object.freeze({
  slug: "all-yourz",
  title: "ALL YOURZ",
  release_type: "singles",
  cover_url: "/api/media/visual?releaseType=singles&slug=all-yourz",
  image_path: "images/singles/all-yourz/",
  video_path: "videos/singles/all-yourz/",
  metadata: { cover_art_r2_key: "images/singles/all-yourz/all-yourz.jpeg" },
});

/** n-2-k-6 — a feature, same shape, cover was completely absent. */
const UPLOADED_FEATURE = Object.freeze({
  slug: "n-2-k-6",
  title: "N.2.K",
  release_type: "features",
  cover_url: "/api/media/visual?releaseType=features&slug=n-2-k-6",
  image_path: "images/features/n-2-k-6/",
  metadata: { cover_art_r2_key: "images/features/n-2-k-6/n-2-k-6.jpeg" },
});

/** 2-heavy — hand-seeded, a real image path. The control: this always worked. */
const SEEDED_FEATURE = Object.freeze({
  slug: "2-heavy",
  title: "Heavy",
  release_type: "features",
  cover_url: "/images/features/2heavy.jpg",
  metadata: {},
});

test("the canonical static key becomes the still, not the discovery URL", () => {
  for (const row of [UPLOADED_SINGLE, UPLOADED_FEATURE]) {
    const mapped = mapProductRow(row);
    // Asserted as a suffix, not equality: the key is resolved to a URL here, and
    // that prefix is environment-dependent (the R2 public base in production, a
    // leading slash when it is unset). What must hold everywhere is that the
    // cover_art_r2_key is what the still was DERIVED from.
    assert.ok(
      String(mapped.baseCover).endsWith(row.metadata.cover_art_r2_key),
      `${row.slug}: baseCover ${mapped.baseCover} is not derived from cover_art_r2_key`
    );
    // And never route-relative, which would resolve against the current page.
    assert.ok(
      /^(https?:)?\/\//i.test(mapped.baseCover) || mapped.baseCover.startsWith("/"),
      `${row.slug}: baseCover ${mapped.baseCover} is relative`
    );
  }
});

test("a discovery URL never reaches the still slot", () => {
  for (const row of [UPLOADED_SINGLE, UPLOADED_FEATURE]) {
    const mapped = mapProductRow(row);
    assert.doesNotMatch(
      String(mapped.baseCover),
      /api\/media\/visual/,
      `${row.slug}: a discovery URL prefers video and cannot be an <img> src`
    );
  }
});

test("the entity FOLDER in image_path is never used as a cover", () => {
  // image_path is "images/singles/all-yourz/" — a directory. It is still-SHAPED
  // (no video extension, not a discovery URL) so the descriptor would accept it
  // and hand an unloadable URL to an <img>.
  const mapped = mapProductRow(UPLOADED_SINGLE);
  assert.notEqual(mapped.baseCover, UPLOADED_SINGLE.image_path);
  assert.doesNotMatch(String(mapped.baseCover), /\/$/, "a cover URL must not be a directory");
});

test("after R2 resolution every uploaded release has a usable <img> src", () => {
  // The end-to-end property: this is what the card and the player actually read.
  for (const row of [UPLOADED_SINGLE, UPLOADED_FEATURE, SEEDED_FEATURE]) {
    const media = withR2CatalogMedia(mapProductRow(row));
    assert.ok(media.baseCover, `${row.slug}: baseCover is empty — renders nothing`);
    assert.ok(
      isStillUrl(media.baseCover),
      `${row.slug}: baseCover ${media.baseCover} is not renderable in an <img>`
    );
    assert.ok(
      /^(https?:)?\/\//i.test(media.baseCover) || media.baseCover.startsWith("/"),
      `${row.slug}: baseCover ${media.baseCover} is relative`
    );
  }
});

test("the hand-seeded control row is unchanged", () => {
  // Guards against the fix altering releases that already worked.
  const mapped = mapProductRow(SEEDED_FEATURE);
  assert.equal(mapped.baseCover, "/images/features/2heavy.jpg");
});
