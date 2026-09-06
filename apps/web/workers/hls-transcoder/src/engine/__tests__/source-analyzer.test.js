import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceAnalysis, runSourceAnalyzer } from "../source-analyzer.js";

function sdrH264Fixture() {
  return {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "125.500000" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        profile: "High",
        level: 51,
        width: 1920,
        height: 1080,
        display_aspect_ratio: "16:9",
        sample_aspect_ratio: "1:1",
        r_frame_rate: "24000/1001",
        avg_frame_rate: "24000/1001",
        duration: "125.500000",
        pix_fmt: "yuv420p",
        color_range: "tv",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
        tags: { rotate: "0" },
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        duration: "125.500000",
      },
    ],
  };
}

function hdrAv1Fixture() {
  return {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "240.000000" },
    streams: [
      {
        codec_type: "video",
        codec_name: "av1",
        width: 3840,
        height: 2160,
        r_frame_rate: "60/1",
        avg_frame_rate: "60/1",
        duration: "240.000000",
        pix_fmt: "yuv420p10le",
        color_range: "tv",
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
        side_data_list: [
          { side_data_type: "Mastering display metadata", red_x: "34000/50000" },
          { side_data_type: "Content light level metadata", max_content: 1000, max_average: 400 },
        ],
      },
    ],
  };
}

test("parses a real SDR H.264+AAC fixture into the canonical shape", () => {
  const result = parseSourceAnalysis(sdrH264Fixture());
  assert.equal(result.videoCodec, "h264");
  assert.equal(result.profile, "High");
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.ok(Math.abs(result.frameRate - 23.976023976023978) < 1e-9);
  assert.equal(result.frameRateMode, "constant");
  assert.equal(result.bitDepth, 8);
  assert.equal(result.chromaFormat, "4:2:0");
  assert.equal(result.hdrMode, "sdr");
  assert.equal(result.masteringMetadata, null);
  assert.equal(result.maxCLL, null);
  assert.equal(result.audioCodec, "aac");
  assert.equal(result.audioSampleRate, 48000);
  assert.equal(result.audioChannels, 2);
  assert.equal(result.rotationDegrees, 0);
});

test("detects genuine HDR10 signaling only from real color metadata (BT.2020 + PQ), never from filename", () => {
  const result = parseSourceAnalysis(hdrAv1Fixture());
  assert.equal(result.hdrMode, "hdr10");
  assert.equal(result.bitDepth, 10);
  assert.deepEqual(result.masteringMetadata, { side_data_type: "Mastering display metadata", red_x: "34000/50000" });
  assert.equal(result.maxCLL, 1000);
  assert.equal(result.maxFALL, 400);
});

test("HLG is distinguished from HDR10 by transfer characteristic, not lumped together", () => {
  const fixture = hdrAv1Fixture();
  fixture.streams[0].color_transfer = "arib-std-b67";
  const result = parseSourceAnalysis(fixture);
  assert.equal(result.hdrMode, "hlg");
});

test("BT.2020 primaries alone, without a PQ/HLG transfer function, is not HDR — never invented from one signal alone", () => {
  const fixture = hdrAv1Fixture();
  fixture.streams[0].color_transfer = "bt709"; // BT.2020 primaries but ordinary SDR transfer
  const result = parseSourceAnalysis(fixture);
  assert.equal(result.hdrMode, "sdr");
});

test("a source with no video stream throws rather than silently returning a partial/fake result", () => {
  assert.throws(() => parseSourceAnalysis({ format: {}, streams: [{ codec_type: "audio", codec_name: "aac" }] }),
    /no video stream found/);
});

test("a video-only source (no audio stream) parses cleanly with all audio fields null, never throwing", () => {
  const fixture = hdrAv1Fixture(); // has no audio stream
  const result = parseSourceAnalysis(fixture);
  assert.equal(result.audioCodec, null);
  assert.equal(result.audioSampleRate, null);
  assert.equal(result.audioChannels, null);
});

test("a meaningfully different r_frame_rate vs avg_frame_rate is treated as variable frame timing", () => {
  const fixture = sdrH264Fixture();
  fixture.streams[0].r_frame_rate = "30/1";
  fixture.streams[0].avg_frame_rate = "29/1";
  const result = parseSourceAnalysis(fixture);
  assert.equal(result.frameRateMode, "variable");
});

test("runSourceAnalyzer invokes ffprobe with the expected arguments and parses its stdout, via an injected exec", async () => {
  let capturedArgs = null;
  const fakeExec = async (bin, args) => {
    capturedArgs = { bin, args };
    return JSON.stringify(sdrH264Fixture());
  };
  const result = await runSourceAnalyzer("/data/jobs/job-1/1/master.mov", { exec: fakeExec });
  assert.equal(result.videoCodec, "h264");
  assert.equal(capturedArgs.bin, "ffprobe");
  assert.ok(capturedArgs.args.includes("/data/jobs/job-1/1/master.mov"));
  assert.ok(capturedArgs.args.includes("-show_streams"));
  assert.ok(capturedArgs.args.includes("-show_format"));
});
