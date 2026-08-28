import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoFfmpegArgs,
  fitWithin,
  measureBandwidth,
  normalizedVideoSource,
  parseFrameRate,
  parseMediaPlaylist,
  selectVideoRenditions,
} from "../src/rendition-contract.js";

test("frame-rate parser accepts rational and decimal rates", () => {
  assert.equal(parseFrameRate("30000/1001").toFixed(3), "29.970");
  assert.equal(parseFrameRate("24"), 24);
  assert.equal(parseFrameRate("0/0"), 0);
});

test("source probe normalizes rotation, caps frame rate, and detects audio", () => {
  const source = normalizedVideoSource({
    streams: [
      {
        codec_type: "video",
        codec_name: "hevc",
        width: 1080,
        height: 1920,
        avg_frame_rate: "60000/1001",
        side_data_list: [{ rotation: 90 }],
      },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  assert.equal(source.width, 1920);
  assert.equal(source.height, 1080);
  assert.equal(source.frameRate, 30);
  assert.equal(source.frameRateExpression, "30");
  assert.equal(source.hasAudio, true);
});

test("video ladder never upscales and removes duplicate resolutions", () => {
  const fullHd = selectVideoRenditions({ width: 1920, height: 1080 });
  assert.deepEqual(fullHd.map((item) => item.label), ["4000k", "2000k", "1000k", "720k"]);
  assert.deepEqual(fullHd.map((item) => `${item.width}x${item.height}`), [
    "1920x1080", "1280x720", "852x480", "640x360",
  ]);

  const hd = selectVideoRenditions({ width: 1280, height: 720 });
  assert.deepEqual(hd.map((item) => item.label), ["2000k", "1000k", "720k"]);

  const sd = selectVideoRenditions({ width: 640, height: 360 });
  assert.deepEqual(sd.map((item) => item.label), ["720k"]);
  assert.deepEqual(fitWithin(640, 360, 1920, 1080), { width: 640, height: 360 });
});

test("requested video labels constrain the ladder without creating duplicates", () => {
  const selected = selectVideoRenditions(
    { width: 1920, height: 1080 },
    ["2000k", "720k", "320k"]
  );
  assert.deepEqual(selected.map((item) => item.label), ["2000k", "720k"]);
});

test("video FFmpeg contract assigns bitrate to video and bounded AAC to audio", () => {
  const rendition = selectVideoRenditions({ width: 1920, height: 1080 }, ["4000k"])[0];
  const args = buildVideoFfmpegArgs({
    inputPath: "source.mp4",
    playlistPath: "playlist.m3u8",
    segmentPattern: "seg_%05d.ts",
    keyInfoFile: "key.info",
    rendition,
    source: { frameRate: 30, frameRateExpression: "30" },
    segmentDuration: 6,
  });
  const valueAfter = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(valueAfter("-c:v"), "libx264");
  assert.equal(valueAfter("-maxrate"), "4000k");
  assert.equal(valueAfter("-b:a"), "160k");
  assert.equal(valueAfter("-profile:v"), "high");
  assert.equal(valueAfter("-level:v"), "4.0");
  assert.equal(valueAfter("-g"), "180");
  assert.match(valueAfter("-vf"), /1920/);
  assert.match(valueAfter("-vf"), /1080/);
  assert.equal(args.includes("-shortest"), true);
});

test("playlist parser preserves exact EXTINF values and declared target", () => {
  const parsed = parseMediaPlaylist([
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:6",
    "#EXTINF:6.013967,",
    "seg_00000.ts",
    "#EXTINF:5.990756,",
    "seg_00001.ts",
  ].join("\n"));
  assert.deepEqual(parsed.durations, [6.013967, 5.990756]);
  assert.equal(parsed.targetDuration, 6);
  assert.equal(parsed.durationSeconds.toFixed(6), "12.004723");
});

test("bandwidth measurement derives average and peak from encoded bytes", () => {
  const sizes = new Map([["a.ts", 1000], ["b.ts", 1500]]);
  const measured = measureBandwidth(
    ["a.ts", "b.ts"],
    [2, 2],
    (file) => ({ size: sizes.get(file) })
  );
  assert.equal(measured.totalBytes, 2500);
  assert.equal(measured.averageBandwidth, 5000);
  assert.equal(measured.peakBandwidth, 6000);
});
