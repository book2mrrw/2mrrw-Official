/**
 * Storage preflight — estimate whether a video job's scratch-disk footprint
 * fits on /data BEFORE FFmpeg ever starts, so an oversized job fails fast and
 * cleanly (RESOURCE_EXHAUSTION) instead of exhausting the volume mid-encode.
 *
 * The estimate is deliberately conservative (never assumes compression will
 * help): master + per-codec-family rendition candidates (bounded by source
 * size, not real encoded size, since retries/mis-encodes can transiently
 * produce more) + VMAF/CAMBI reference-decode overhead + packaging overhead
 * + retry headroom. Tune the constants once real per-title benchmark data
 * exists (Part H) — this is a safe starting model, not a final one.
 */
import fs from "fs";

export const SAFETY_RESERVE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB fixed margin, tune from real usage data

/**
 * Bytes free on the given mount, via Node's native fs.statfsSync — not by
 * shelling out to `df` and parsing its output, which differs incompatibly
 * between BSD df (macOS, used in local dev) and GNU df (the production
 * Debian container): GNU's `-B1` block-size flag isn't recognized by BSD df
 * at all. statfsSync works identically on both.
 */
export function getAvailableScratchBytes(mountPath = "/data") {
  const stats = fs.statfsSync(mountPath);
  return stats.bavail * stats.bsize;
}

export function estimateRequiredScratchBytes({
  sourceFileSizeBytes,
  codecFamilies = ["avc", "av1"],
  renditionCount = 4,
  hasHdr = false,
}) {
  if (!Number.isFinite(sourceFileSizeBytes) || sourceFileSizeBytes <= 0) {
    throw new Error("estimateRequiredScratchBytes: sourceFileSizeBytes must be a positive number");
  }
  const perRenditionEstimate = sourceFileSizeBytes; // conservative ceiling, not a real compression estimate
  const renditionsTotal = codecFamilies.length * renditionCount * perRenditionEstimate;
  const qualityEvalOverhead = sourceFileSizeBytes * 2; // decoded reference frames for VMAF/CAMBI
  const packagingOverhead = renditionsTotal * 0.2;     // segmenting/manifest/init-segment duplication
  const retryHeadroom = (renditionsTotal + qualityEvalOverhead) * 0.5; // room for one full retry pass
  const hdrOverhead = hasHdr ? sourceFileSizeBytes * 0.5 : 0;          // extra SDR tone-mapped derivative set

  return Math.ceil(
    sourceFileSizeBytes + renditionsTotal + qualityEvalOverhead + packagingOverhead + retryHeadroom + hdrOverhead
  );
}

/**
 * Full preflight check. Matches the audio_visual_asset_versions.storage_preflight
 * jsonb shape exactly: { requiredScratchBytes, availableScratchBytes, safetyReserveBytes, verdict }.
 * Never starts FFmpeg itself — callers decide what to do with an "insufficient" verdict.
 */
export async function runStoragePreflight({
  sourceFileSizeBytes,
  codecFamilies,
  renditionCount,
  hasHdr,
  mountPath = "/data",
}) {
  const requiredScratchBytes = estimateRequiredScratchBytes({
    sourceFileSizeBytes,
    codecFamilies,
    renditionCount,
    hasHdr,
  });
  const availableScratchBytes = await getAvailableScratchBytes(mountPath);
  const verdict = availableScratchBytes - SAFETY_RESERVE_BYTES >= requiredScratchBytes ? "ok" : "insufficient";

  return {
    requiredScratchBytes,
    availableScratchBytes,
    safetyReserveBytes: SAFETY_RESERVE_BYTES,
    verdict,
  };
}
