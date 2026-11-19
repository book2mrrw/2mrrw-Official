import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Real bug, found and fixed: the Dockerfile once copied only ffmpeg from its
// FFmpeg build stage, never ffprobe — confirmed missing on the live video
// machine ("ffprobe: not found") before that fix. SourceAnalyzer and
// SceneComplexityAnalyzer both depend on a real ffprobe binary; without it,
// every video job would fail at the very first pipeline stage. The stage is
// now FFmpeg built from its release tarball (ffmpeg-build), not a download.

test("the Dockerfile copies both ffmpeg and ffprobe (and libplacebo) from the FFmpeg build stage", () => {
  const dockerfile = read("workers/hls-transcoder/Dockerfile");
  assert.match(dockerfile, /COPY --from=ffmpeg-build \/opt\/ffmpeg\/bin\/ffmpeg \/usr\/local\/bin\/ffmpeg/);
  assert.match(dockerfile, /COPY --from=ffmpeg-build \/opt\/ffmpeg\/bin\/ffprobe \/usr\/local\/bin\/ffprobe/);
  assert.match(dockerfile, /COPY --from=ffmpeg-build \/usr\/local\/lib\/libplacebo\.so\.\* \/usr\/local\/lib\//);
});
