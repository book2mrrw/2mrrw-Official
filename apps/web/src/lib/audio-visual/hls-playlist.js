/**
 * Pure HLS master-playlist/key-URI logic for Audio Visual delivery,
 * factored out of the route handlers themselves so it's directly testable
 * without spinning up a Next.js request/response cycle — mirrors the
 * "engine logic separate from I/O glue" split already used throughout
 * workers/hls-transcoder/src/engine/.
 *
 * Bandwidth hints are static heuristics per (codecFamily, resolutionLabel),
 * not a measured value — audio_visual_renditions has no stored bitrate
 * column since these are CRF/VBR encodes with no fixed target bitrate.
 * This mirrors Vault's own video manifest route exactly (its
 * BITRATE_BANDWIDTH table is the same kind of static ABR hint, not a
 * measured number) — not a shortcut unique to this file.
 */

const BANDWIDTH_HINTS = {
  avc: { "2160p": 16_000_000, "1440p": 9_000_000, "1080p": 5_000_000, "720p": 2_800_000, "480p": 1_400_000 },
  av1: { "2160p": 9_000_000, "1440p": 5_000_000, "1080p": 2_800_000, "720p": 1_600_000, "480p": 800_000 },
};

const RESOLUTION_DIMENSIONS = {
  "2160p": { width: 3840, height: 2160 },
  "1440p": { width: 2560, height: 1440 },
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
};

const CODECS_ATTRIBUTE = {
  avc: 'avc1.640028,mp4a.40.2',
  av1: 'av01.0.09M.08,mp4a.40.2',
};

export function bandwidthHintFor(codecFamily, resolutionLabel) {
  return BANDWIDTH_HINTS[codecFamily]?.[resolutionLabel] ?? 3_000_000;
}

export function dimensionsForResolutionLabel(resolutionLabel) {
  return RESOLUTION_DIMENSIONS[resolutionLabel] || null;
}

export function codecsAttributeFor(codecFamily) {
  return CODECS_ATTRIBUTE[codecFamily] || CODECS_ATTRIBUTE.avc;
}

/**
 * @param {object} params
 * @param {Array<{ codec_family: string, resolution_label: string }>} params.renditions
 * @param {(rendition: object) => string} params.variantUrlForRendition
 */
export function buildAudioVisualMasterPlaylist({ renditions, variantUrlForRendition }) {
  if (!Array.isArray(renditions) || renditions.length === 0) {
    throw new Error("buildAudioVisualMasterPlaylist: at least one rendition is required");
  }
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", ""];
  for (const rendition of renditions) {
    const bandwidth = bandwidthHintFor(rendition.codec_family, rendition.resolution_label);
    const codecs = codecsAttributeFor(rendition.codec_family);
    const dims = dimensionsForResolutionLabel(rendition.resolution_label);
    const resAttr = dims ? `,RESOLUTION=${dims.width}x${dims.height}` : "";
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="${codecs}"${resAttr}`, variantUrlForRendition(rendition));
  }
  return lines.join("\n");
}

// Contract with the (not yet built) pipeline orchestrator that calls
// packaging.js's rewritePlaylistForEncryption at encode time: the stored
// playlist's #EXT-X-KEY URI is always exactly this literal placeholder,
// replaced here, at request time, with a real per-user signed key URL —
// the actual key URL can't be known at encode time since it must carry a
// per-request auth token.
export const PLACEHOLDER_KEY_URI = "placeholder";

/**
 * @param {string} playlistText - the stored, already-encrypted playlist (see packaging.js)
 * @param {string} realKeyUrl - the per-user, per-request signed key-delivery URL
 */
export function rewritePlaylistKeyUri(playlistText, realKeyUrl) {
  const lines = playlistText.split("\n");
  let replaced = false;
  const rewritten = lines.map((line) => {
    if (line.startsWith("#EXT-X-KEY:") && line.includes(`URI="${PLACEHOLDER_KEY_URI}"`)) {
      replaced = true;
      return line.replace(`URI="${PLACEHOLDER_KEY_URI}"`, `URI="${realKeyUrl}"`);
    }
    return line;
  });
  if (!replaced) {
    throw new Error(
      "rewritePlaylistKeyUri: no #EXT-X-KEY line with the expected placeholder URI was found in the stored playlist"
    );
  }
  return rewritten.join("\n");
}
