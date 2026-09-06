import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Real bug, found and fixed: the Dockerfile copied only /ffmpeg from the
// static-ffmpeg build stage, never /ffprobe — confirmed missing on the live
// video machine ("ffprobe: not found") before this fix. SourceAnalyzer and
// SceneComplexityAnalyzer both depend on a real ffprobe binary; without this,
// every video job would have failed at the very first pipeline stage.

test("the Dockerfile copies both ffmpeg and ffprobe from the static-ffmpeg build stage", () => {
  const dockerfile = read("workers/hls-transcoder/Dockerfile");
  assert.match(dockerfile, /COPY --from=ffmpeg-stage \/ffmpeg \/usr\/local\/bin\/ffmpeg/);
  assert.match(dockerfile, /COPY --from=ffmpeg-stage \/ffprobe \/usr\/local\/bin\/ffprobe/);
});
