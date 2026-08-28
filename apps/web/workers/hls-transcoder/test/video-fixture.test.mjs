import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVideoFfmpegArgs,
  parseMediaPlaylist,
  selectVideoRenditions,
} from "../src/rendition-contract.js";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const available = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0
  && spawnSync(ffprobe, ["-version"], { stdio: "ignore" }).status === 0;

test("real video fixture produces bounded H.264/AAC HLS", { skip: !available }, () => {
  const dir = mkdtempSync(join(tmpdir(), "2mrrw-video-contract-"));
  try {
    const source = join(dir, "source.mp4");
    const playlist = join(dir, "playlist.m3u8");
    const segmentPattern = join(dir, "seg_%05d.ts");
    const keyPath = join(dir, "key.bin");
    const keyInfoPath = join(dir, "key.info");
    writeFileSync(keyPath, Buffer.alloc(16, 7));
    writeFileSync(keyInfoPath, `key.bin\n${keyPath}\n00112233445566778899aabbccddeeff\n`);

    execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6.5",
      "-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=6.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
    ]);

    const rendition = selectVideoRenditions(
      { width: 1280, height: 720 },
      ["720k"]
    )[0];
    const args = buildVideoFfmpegArgs({
      inputPath: source,
      playlistPath: playlist,
      segmentPattern,
      keyInfoFile: keyInfoPath,
      rendition,
      source: { frameRate: 30, frameRateExpression: "30" },
      segmentDuration: 6,
    });
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args]);

    const parsedPlaylist = parseMediaPlaylist(readFileSync(playlist, "utf8"));
    assert.ok(parsedPlaylist.durations.length >= 2);
    const probe = JSON.parse(execFileSync(ffprobe, [
      "-v", "error", "-allowed_extensions", "ALL",
      "-show_streams", "-of", "json", playlist,
    ], { encoding: "utf8" }));
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.width, 640);
    assert.equal(video.height, 360);
    assert.equal(audio.codec_name, "aac");
    assert.equal(Number(audio.sample_rate), 48_000);
    assert.equal(Number(audio.channels), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
