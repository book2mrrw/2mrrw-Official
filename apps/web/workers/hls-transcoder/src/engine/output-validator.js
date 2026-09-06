/**
 * OutputValidator — an FFmpeg exit code of 0 is the START of validation,
 * never the finish line. Confirms the packaged HLS output is actually
 * complete and correct before it's ever eligible for publication:
 * manifest parses, every referenced segment file actually exists, no
 * upscale occurred, duration matches the source within tolerance.
 *
 * Pure filesystem/text-parsing logic — no FFmpeg invocation here. Decode
 * verification (actually decoding the packaged output) reuses the same
 * spawn-based check already built for source QC (source-quality-control.js's
 * runDecodeSanityCheck), pointed at the packaged playlist instead of the
 * original source — the caller wires that together, not this module.
 */
import fs from "fs";
import path from "path";

function parsePlaylist(playlistText) {
  const lines = playlistText.split("\n").map((l) => l.trim());
  const initMatch = playlistText.match(/#EXT-X-MAP:URI="([^"]+)"/);
  const segments = [];
  let totalDuration = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXTINF:")) {
      const duration = parseFloat(lines[i].replace("#EXTINF:", "").replace(",", ""));
      if (Number.isFinite(duration)) totalDuration += duration;
      const segmentLine = lines[i + 1];
      if (segmentLine && !segmentLine.startsWith("#")) segments.push(segmentLine);
    }
  }

  return { initSegment: initMatch?.[1] || null, segments, totalDuration };
}

/**
 * @param {object} params
 * @param {string} params.outputDir - directory containing playlist.m3u8 + init/segment files
 * @param {object} [params.expectedRendition] - the RenditionPlanner entry this output should match
 * @param {object} [params.sourceAnalysis] - SourceAnalyzer output, for duration/upscale checks
 * @param {number} [params.durationToleranceSeconds]
 */
export function validatePackagedOutput({ outputDir, expectedRendition, sourceAnalysis, durationToleranceSeconds = 2 }) {
  const failures = [];
  const playlistPath = path.join(outputDir, "playlist.m3u8");

  if (!fs.existsSync(playlistPath)) {
    return {
      passed: false,
      failures: [{ code: "OUTPUT_VALIDATION_FAILURE", message: "playlist.m3u8 does not exist" }],
      totalDuration: null,
      segmentCount: 0,
    };
  }

  const playlistText = fs.readFileSync(playlistPath, "utf8");
  if (!playlistText.includes("#EXTM3U")) {
    failures.push({ code: "OUTPUT_VALIDATION_FAILURE", message: "playlist does not start with #EXTM3U" });
  }

  const { initSegment, segments, totalDuration } = parsePlaylist(playlistText);

  if (!initSegment) {
    failures.push({ code: "OUTPUT_VALIDATION_FAILURE", message: "playlist has no #EXT-X-MAP init segment reference" });
  } else if (!fs.existsSync(path.join(outputDir, initSegment))) {
    failures.push({ code: "OUTPUT_VALIDATION_FAILURE", message: `init segment file missing: ${initSegment}` });
  }

  if (segments.length === 0) {
    failures.push({ code: "OUTPUT_VALIDATION_FAILURE", message: "playlist references zero media segments" });
  }
  for (const segment of segments) {
    if (!fs.existsSync(path.join(outputDir, segment))) {
      failures.push({ code: "OUTPUT_VALIDATION_FAILURE", message: `segment file missing: ${segment}` });
    }
  }

  if (expectedRendition && sourceAnalysis && expectedRendition.height > sourceAnalysis.height) {
    failures.push({
      code: "OUTPUT_VALIDATION_FAILURE",
      message: `rendition height ${expectedRendition.height} exceeds source height ${sourceAnalysis.height} — upscale is never permitted`,
    });
  }

  if (sourceAnalysis?.durationSeconds && Number.isFinite(totalDuration)) {
    const diff = Math.abs(totalDuration - sourceAnalysis.durationSeconds);
    if (diff > durationToleranceSeconds) {
      failures.push({
        code: "OUTPUT_VALIDATION_FAILURE",
        message: `packaged duration ${totalDuration}s differs from source duration ${sourceAnalysis.durationSeconds}s by more than ${durationToleranceSeconds}s`,
      });
    }
  }

  return { passed: failures.length === 0, failures, totalDuration, segmentCount: segments.length };
}
