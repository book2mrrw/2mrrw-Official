import assert from "node:assert/strict";
import test from "node:test";
import {
  bandwidthHintFor,
  buildAudioVisualMasterPlaylist,
  codecsAttributeFor,
  dimensionsForResolutionLabel,
  PLACEHOLDER_KEY_URI,
  rewritePlaylistKeyUri,
} from "../hls-playlist.js";

test("bandwidthHintFor: AV1 gets a lower bandwidth hint than AVC at the same resolution (real-world codec efficiency)", () => {
  const avc = bandwidthHintFor("avc", "1080p");
  const av1 = bandwidthHintFor("av1", "1080p");
  assert.ok(av1 < avc, "AV1 should hint a lower bitrate than AVC for equivalent quality at the same resolution");
});

test("bandwidthHintFor: an unknown codec/resolution combination falls back to a safe default rather than NaN/undefined", () => {
  assert.equal(bandwidthHintFor("hevc", "8k"), 3_000_000);
});

test("dimensionsForResolutionLabel: known labels map to real 16:9 dimensions", () => {
  assert.deepEqual(dimensionsForResolutionLabel("1080p"), { width: 1920, height: 1080 });
  assert.deepEqual(dimensionsForResolutionLabel("720p"), { width: 1280, height: 720 });
});

test("dimensionsForResolutionLabel: an unknown label returns null rather than fabricated dimensions", () => {
  assert.equal(dimensionsForResolutionLabel("potato"), null);
});

test("codecsAttributeFor: falls back to the AVC codecs string for an unrecognized codec family", () => {
  assert.equal(codecsAttributeFor("unknown"), codecsAttributeFor("avc"));
});

test("buildAudioVisualMasterPlaylist: builds one #EXT-X-STREAM-INF/URI pair per rendition, in order", () => {
  const renditions = [
    { codec_family: "avc", resolution_label: "1080p" },
    { codec_family: "av1", resolution_label: "720p" },
  ];
  const playlist = buildAudioVisualMasterPlaylist({
    renditions,
    variantUrlForRendition: (r) => `https://example.com/variant?cf=${r.codec_family}&rl=${r.resolution_label}`,
  });
  const lines = playlist.split("\n");
  assert.equal(lines[0], "#EXTM3U");
  assert.equal(lines[1], "#EXT-X-VERSION:7");

  const infIndex = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF") && l.includes('CODECS="avc1'));
  assert.ok(infIndex !== -1);
  assert.equal(lines[infIndex + 1], "https://example.com/variant?cf=avc&rl=1080p");
  assert.match(lines[infIndex], /RESOLUTION=1920x1080/);

  const av1InfIndex = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF") && l.includes('CODECS="av01'));
  assert.ok(av1InfIndex !== -1);
  assert.equal(lines[av1InfIndex + 1], "https://example.com/variant?cf=av1&rl=720p");
});

test("buildAudioVisualMasterPlaylist: throws rather than producing an empty/broken master playlist when there are no renditions", () => {
  assert.throws(
    () => buildAudioVisualMasterPlaylist({ renditions: [], variantUrlForRendition: () => "x" }),
    /at least one rendition is required/
  );
});

// ── rewritePlaylistKeyUri ──

const STORED_PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:6",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  `#EXT-X-KEY:METHOD=AES-128,URI="${PLACEHOLDER_KEY_URI}",IV=0xaabbccdd00000000000000000000000`,
  '#EXT-X-MAP:URI="init.mp4"',
  "#EXTINF:6.000000,",
  "seg_00000.m4s",
  "#EXT-X-ENDLIST",
].join("\n");

test("rewritePlaylistKeyUri: replaces the placeholder URI with the real signed key URL, leaving IV and every other line untouched", () => {
  const realUrl = "https://example.com/api/audio-visual/video-1/key?token=abc123";
  const rewritten = rewritePlaylistKeyUri(STORED_PLAYLIST, realUrl);
  const keyLine = rewritten.split("\n").find((l) => l.startsWith("#EXT-X-KEY:"));
  assert.match(keyLine, /URI="https:\/\/example\.com\/api\/audio-visual\/video-1\/key\?token=abc123"/);
  assert.match(keyLine, /IV=0xaabbccdd00000000000000000000000/);

  const withoutKeyLine = rewritten.split("\n").filter((l) => !l.startsWith("#EXT-X-KEY:"));
  const originalWithoutKeyLine = STORED_PLAYLIST.split("\n").filter((l) => !l.startsWith("#EXT-X-KEY:"));
  assert.deepEqual(withoutKeyLine, originalWithoutKeyLine);
});

test("rewritePlaylistKeyUri: throws rather than silently serving an unrewritten placeholder URI when the playlist doesn't match the expected contract", () => {
  const noKeyPlaylist = STORED_PLAYLIST.split("\n").filter((l) => !l.startsWith("#EXT-X-KEY:")).join("\n");
  assert.throws(
    () => rewritePlaylistKeyUri(noKeyPlaylist, "https://example.com/key"),
    /no #EXT-X-KEY line with the expected placeholder URI/
  );
});

test("rewritePlaylistKeyUri: a playlist whose key URI is already something other than the placeholder also throws, rather than silently leaving a stale/wrong URI in place", () => {
  const alreadyRewritten = STORED_PLAYLIST.replace(`URI="${PLACEHOLDER_KEY_URI}"`, 'URI="https://stale-url.example.com"');
  assert.throws(() => rewritePlaylistKeyUri(alreadyRewritten, "https://example.com/key"));
});
