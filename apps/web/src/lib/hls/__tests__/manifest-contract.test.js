import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HLS_MANIFEST_SELECT_FIELDS,
  getExactSegmentDurations,
  getRenditionStreamMetadata,
  positiveFrameRate,
  safeCodecs,
} from "../manifest-contract.js";

describe("canonical HLS manifest contract", () => {
  test("all playlist routes receive the complete cached row shape", () => {
    for (const field of [
      "bitrates",
      "segment_counts",
      "segment_durations",
      "rendition_metadata",
      "media_kind",
      "transcode_profile_version",
      "poster_key",
      "vtt_key",
    ]) assert.match(HLS_MANIFEST_SELECT_FIELDS, new RegExp(`\\b${field}\\b`));
  });

  test("measured audio bandwidth replaces legacy estimates", () => {
    const manifest = {
      rendition_metadata: {
        "160k": {
          average_bandwidth: 166_250,
          peak_bandwidth: 174_900,
          codecs: "mp4a.40.2",
        },
      },
    };
    assert.deepEqual(
      getRenditionStreamMetadata(manifest, "160k", {
        fallbackBandwidth: 180_000,
        fallbackCodecs: "mp4a.40.2",
      }),
      {
        metadata: manifest.rendition_metadata["160k"],
        bandwidth: 174_900,
        averageBandwidth: 166_250,
        codecs: "mp4a.40.2",
      }
    );
  });

  test("BANDWIDTH cannot fall below a malformed average measurement", () => {
    const result = getRenditionStreamMetadata({
      rendition_metadata: {
        "96k": { average_bandwidth: 110_000, peak_bandwidth: 90_000 },
      },
    }, "96k", {
      fallbackBandwidth: 108_000,
      fallbackCodecs: "mp4a.40.2",
    });
    assert.equal(result.bandwidth, 110_000);
    assert.equal(result.averageBandwidth, 110_000);
  });

  test("legacy and unsafe metadata receives conservative fallbacks", () => {
    const result = getRenditionStreamMetadata({
      rendition_metadata: { "320k": { codecs: 'aac\",INJECTED=YES' } },
    }, "320k", {
      fallbackBandwidth: 360_000,
      fallbackCodecs: "mp4a.40.2",
    });
    assert.equal(result.bandwidth, 360_000);
    assert.equal(result.averageBandwidth, null);
    assert.equal(result.codecs, "mp4a.40.2");
    assert.equal(safeCodecs("avc1.640028,mp4a.40.2", "fallback"), "avc1.640028,mp4a.40.2");
    assert.equal(positiveFrameRate("29.97"), "29.970");
  });

  test("exact durations require complete positive rendition timing", () => {
    const manifest = { segment_durations: { "96k": [6.013, "5.99"] } };
    assert.deepEqual(getExactSegmentDurations(manifest, "96k", 2), [6.013, 5.99]);
    assert.equal(getExactSegmentDurations(manifest, "96k", 3), null);
    assert.equal(getExactSegmentDurations({ segment_durations: { "96k": [6, 0] } }, "96k", 2), null);
  });
});
