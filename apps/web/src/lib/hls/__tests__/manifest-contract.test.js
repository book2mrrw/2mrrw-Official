import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HLS_MANIFEST_SELECT_FIELDS,
  getExactSegmentDurations,
  getRenditionStreamMetadata,
  positiveFrameRate,
  safeCodecs,
} from "../manifest-contract.js";
import {
  AUDIO_FORWARD_BUFFER_SECONDS,
  AUDIO_INITIAL_BANDWIDTH_ESTIMATE,
  AUDIO_MAX_FORWARD_BUFFER_SECONDS,
  AUDIO_PREFETCH_BUFFER_SECONDS,
  AUDIO_SEGMENT_DURATION_SECONDS,
  AUDIO_STARTUP_BUFFER_SECONDS,
  VIDEO_SEGMENT_DURATION_SECONDS,
  isLikelyVideoSourceKey,
  segmentDurationForSourceKey,
} from "../playback-quality-policy.js";
import {
  parseHlsSegments,
  parseHlsStartupVariantUrl,
} from "../../audio/hls-segment-prefetcher.js";

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

describe("production HLS quality policy", () => {
  test("uses short media-specific segments and a bounded audio buffer", () => {
    assert.equal(AUDIO_SEGMENT_DURATION_SECONDS, 2);
    assert.equal(VIDEO_SEGMENT_DURATION_SECONDS, 4);
    assert.equal(AUDIO_STARTUP_BUFFER_SECONDS, 1.5);
    assert.equal(AUDIO_PREFETCH_BUFFER_SECONDS, 6);
    assert.equal(AUDIO_FORWARD_BUFFER_SECONDS, 30);
    assert.equal(AUDIO_MAX_FORWARD_BUFFER_SECONDS, 45);
    assert.equal(AUDIO_INITIAL_BANDWIDTH_ESTIMATE, 250_000);
  });

  test("queue hints distinguish video masters without trusting request tuning", () => {
    assert.equal(isLikelyVideoSourceKey("vault/drop/master.MOV"), true);
    assert.equal(isLikelyVideoSourceKey("audio/single/master.m4a"), false);
    assert.equal(segmentDurationForSourceKey("vault/drop/master.webm"), 4);
    assert.equal(segmentDurationForSourceKey("audio/single/master.wav"), 2);
  });

  test("prefetch selects the middle startup rendition by measured bandwidth", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=365000,CODECS=\"mp4a.40.2\"",
      "high.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=182000,CODECS=\"mp4a.40.2\"",
      "middle.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=108000,CODECS=\"mp4a.40.2\"",
      "low.m3u8",
    ].join("\n");
    assert.equal(
      parseHlsStartupVariantUrl(master, "https://app.example/api/master.m3u8"),
      "https://app.example/api/middle.m3u8"
    );
  });

  test("prefetch parser preserves exact fragment durations and canonical URLs", () => {
    const playlist = [
      "#EXTM3U",
      "#EXTINF:2.013967,",
      "https://cdn.example/seg_00001.ts",
      "#EXTINF:1.990756,",
      "seg_00002.ts",
    ].join("\n");
    assert.deepEqual(
      parseHlsSegments(playlist, "https://cdn.example/hls/playlist.m3u8"),
      [
        { url: "https://cdn.example/seg_00001.ts", duration: 2.013967 },
        { url: "https://cdn.example/hls/seg_00002.ts", duration: 1.990756 },
      ]
    );
  });
});
