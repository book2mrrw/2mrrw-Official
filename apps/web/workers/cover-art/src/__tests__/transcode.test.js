import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planRenditions, transcodeCover } from "../transcode.js";

// The image ships ffmpeg/ffprobe on PATH; a developer machine can point at its own.
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const ffprobe = process.env.FFPROBE || "ffprobe";

function streams(file) {
  const out = execFileSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate", "-of", "json", file]);
  return JSON.parse(out).streams;
}

/** True when the MP4 index (moov) comes before the media (mdat): playback starts from the first bytes. */
function fastStart(file) {
  const bytes = readFileSync(file);
  return bytes.indexOf("moov") < bytes.indexOf("mdat");
}

function source(dir, name, size, fps) {
  const file = join(dir, name);
  execFileSync(ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=${fps}:duration=2`,
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
  ]);
  return file;
}

test("a 1080 cover gets three silent squares and a 3:4 tall; a 720 cover is never upscaled", () => {
  assert.deepEqual(planRenditions({ width: 1098, height: 1080 }).map((r) => `${r.id} ${r.width}x${r.height}`),
    ["square-1080 1080x1080", "square-720 720x720", "square-480 480x480", "tall 810x1080"]);
  assert.deepEqual(planRenditions({ width: 720, height: 720 }).map((r) => `${r.id} ${r.width}x${r.height}`),
    ["square-720 720x720", "square-480 480x480", "tall 540x720"]);
  assert.deepEqual(planRenditions({ width: 400, height: 300 }).map((r) => `${r.id} ${r.width}x${r.height}`),
    ["square-300 300x300", "tall 224x300"]);
});

test("every rendition is silent, exactly sized, at most 30 fps and starts from its first bytes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cover-art-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = source(dir, "cover.mp4", "1098x1080", 60);
  assert.ok(streams(input).some((s) => s.codec_type === "audio"), "the fixture carries audio like the real uploads");

  const { renditions } = await transcodeCover(input, dir, { ffmpeg, ffprobe });
  assert.deepEqual(renditions.map((r) => r.id), ["square-1080", "square-720", "square-480", "tall"]);
  for (const rendition of renditions) {
    const found = streams(rendition.file);
    assert.deepEqual(found.map((s) => s.codec_type), ["video"], `${rendition.id} has no audio`);
    assert.equal(`${found[0].width}x${found[0].height}`, `${rendition.width}x${rendition.height}`);
    const [num, den] = found[0].avg_frame_rate.split("/").map(Number);
    assert.ok(num / den <= 30.01, `${rendition.id} plays at most 30 fps`);
    assert.ok(fastStart(rendition.file), `${rendition.id} starts from its first bytes`);
  }
});
