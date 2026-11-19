import assert from "node:assert/strict";
import test from "node:test";
import { videoTranscodeJobRow } from "../video-job.js";
import { VIDEO_RENDITIONS } from "../../hls/video-renditions.js";

const VERSION = "6f1c2e8a-3b4d-4c5e-9f60-718293a4b5c6";

// Production's hls_base_prefix(): what trg_hls_prepare_job_generation accepts.
const ACCEPTED_PREFIX = /^hls\/[a-zA-Z0-9._/-]+\/$/;

test("a master's job row satisfies the production job table: slug, hls/ prefix, video renditions", () => {
  const row = videoTranscodeJobRow({ assetVersionId: VERSION, sourceKey: "2MRRW Studios/Audio Visualz/late-night/master-1.mov", queuedBy: "admin-1" });
  assert.deepEqual(row, {
    job_type: "video",
    slug: `audio-visual/${VERSION}`,
    release_type: "audio_visual",
    asset_version_id: VERSION,
    source_key: "2MRRW Studios/Audio Visualz/late-night/master-1.mov",
    hls_prefix: `hls/audio-visual/${VERSION}/`,
    bitrates: VIDEO_RENDITIONS,
    status: "pending",
    queued_by: "admin-1",
  });
  assert.match(row.hls_prefix, ACCEPTED_PREFIX);
  assert.ok(!row.hls_prefix.includes(".."));
  assert.ok(row.slug.includes("/"), "never equal to a release slug, which the unique (slug, track_slug) index shares");
});

test("each master gets its own job identity", () => {
  const other = "0d4b2a6e-1c3f-4e5a-8b7c-9d0e1f2a3b4c";
  const a = videoTranscodeJobRow({ assetVersionId: VERSION, sourceKey: "k" });
  const b = videoTranscodeJobRow({ assetVersionId: other, sourceKey: "k" });
  assert.notEqual(a.slug, b.slug);
  assert.notEqual(a.hls_prefix, b.hls_prefix);
});

test("no row without a real asset version or source", () => {
  assert.throws(() => videoTranscodeJobRow({ assetVersionId: "../x", sourceKey: "k" }), /asset version id/);
  assert.throws(() => videoTranscodeJobRow({ sourceKey: "k" }), /asset version id/);
  assert.throws(() => videoTranscodeJobRow({ assetVersionId: VERSION }), /source key/);
});
