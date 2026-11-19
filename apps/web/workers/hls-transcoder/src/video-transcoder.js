/**
 * Video transcode processor — the job_type='video' dispatch target,
 * imported only by video-worker.js. This is the ONLY file that wires
 * Slices 7-14's individually-tested engine modules (SourceAnalyzer,
 * SourceQualityControl, SceneComplexityAnalyzer, StoragePreflight,
 * RenditionPlanner, CodecEngine AVC/AV1, hdr-tonemap, QualityEvaluator,
 * PackagingEngine, OutputValidator, PeekGenerator, PublicationAuthority)
 * into one real pipeline that runs when a job is claimed. Every one of
 * those modules already has its own unit tests with injectable
 * dependencies — this file is deliberately about SEQUENCING and WIRING,
 * not re-testing each engine's own internal correctness. Every stage is
 * itself injectable via the `deps` parameter (defaulting to the real
 * modules) so this orchestrator's sequencing/error-handling is testable
 * without a real FFmpeg/ffprobe binary, matching every engine module's own
 * spawnFn-injection convention one level up.
 *
 * Isolation: never imports transcoder.js, and never writes to
 * hls_manifests (the audio-only completion record) — a video job's
 * completion is fully expressed by audio_visual_asset_versions' status
 * and audio_visual_renditions rows.
 *
 * Leases (media-lane.js): every write that changes what is published goes
 * through a fenced lane function named by this job's lease — the analysis
 * (hls_video_job_encoding) and the publication itself (hls_commit_video_job:
 * renditions, ready, promotion and job complete in one transaction). A
 * refusal means another worker now holds the job: LeaseLost, nothing written.
 * Each attempt uploads under its own generation folder
 * (.../renditions/{assetVersionId}/g{generation}/), so two attempts never
 * write the same object.
 *
 * NOT YET CONFIRMED LIVE: every engine this wires together was confirmed
 * against the real production machine in its own slice, but this specific
 * end-to-end sequence has not been run against a real job — no Docker/
 * Linux runtime was available to do that from where this was written. Per
 * this project's standing policy, confirm this against a real upload
 * before trusting it in production, the same way every prior slice was
 * confirmed.
 *
 * Keyless (lane-transfers.js): the lane holds no storage key, no master
 * secret and no service-role key. The website's lane session (`lane`) gives
 * this job its master's read link, write links under this attempt's folder
 * (`lane.prefix`), this version's content key (`lane.encryption`) and the
 * video's details (`lane.context`); `rpc` calls the fenced lane functions as
 * the lane's own database login (lane-db.js).
 *
 * rpc/lease/lane are REQUIRED deps, never defaulted, so this file stays safe
 * to import in a test with no env vars set. video-worker.js is the one real
 * caller and passes the real ones in.
 */
import fs from "fs";
import path from "path";
import { createJobWorkDir, cleanupJobWorkDir } from "./engine/scratch-workspace.js";
import { runSourceAnalyzer } from "./engine/source-analyzer.js";
import { validateSourceAnalysis, runDecodeSanityCheck } from "./engine/source-quality-control.js";
import { runSceneComplexityAnalyzer } from "./engine/scene-complexity-analyzer.js";
import { runStoragePreflight } from "./engine/storage-preflight.js";
import { planRenditions } from "./engine/rendition-planner.js";
import { encodeAvcRendition } from "./engine/codec-avc.js";
import { encodeAv1Rendition } from "./engine/codec-av1.js";
import { tonemapHdrToSdr } from "./engine/hdr-tonemap.js";
import { runQualityGatedEncode } from "./engine/quality-evaluator.js";
import { validatePackagedOutput } from "./engine/output-validator.js";
import { encryptRenditionSegments, rewritePlaylistForEncryption } from "./engine/packaging.js";
import { generatePeekClip } from "./engine/peek-generator.js";
import { LeaseLost } from "./media-lane.js";

// Starting quality-gate policy, not final — mirrors rendition-planner.js's
// own "documented starting policy, calibrate against real representative
// masters later" stance. VMAF ~93 and SSIM ~0.95 are conventional
// "visually lossless for streaming" floors; CAMBI ~8 is a conservative
// banding ceiling (0 = no banding).
const DEFAULT_QUALITY_THRESHOLDS = { minVmaf: 93, maxCambi: 8, minSsim: 0.95 };

// Every engine-function default below is safe to import unconditionally
// (no env-var-gated singleton behind any of them) — only rpc/lease/lane are
// excluded and required from the caller.
const DEFAULT_ENGINE_DEPS = {
  runSourceAnalyzerFn: runSourceAnalyzer,
  validateSourceAnalysisFn: validateSourceAnalysis,
  runDecodeSanityCheckFn: runDecodeSanityCheck,
  runSceneComplexityAnalyzerFn: runSceneComplexityAnalyzer,
  runStoragePreflightFn: runStoragePreflight,
  planRenditionsFn: planRenditions,
  encodeAvcRenditionFn: encodeAvcRendition,
  encodeAv1RenditionFn: encodeAv1Rendition,
  tonemapHdrToSdrFn: tonemapHdrToSdr,
  runQualityGatedEncodeFn: runQualityGatedEncode,
  validatePackagedOutputFn: validatePackagedOutput,
  encryptRenditionSegmentsFn: encryptRenditionSegments,
  rewritePlaylistForEncryptionFn: rewritePlaylistForEncryption,
  generatePeekClipFn: generatePeekClip,
  createJobWorkDirFn: createJobWorkDir,
  cleanupJobWorkDirFn: cleanupJobWorkDir,
};

// The attempt folder comes from the website (lane.prefix): the confirmed
// "2MRRW Studios/{Content-Type Folder}/{slug}/" (or .../Seriez/{seriezSlug}/
// {episodeSlug}/) convention + renditions/{assetVersionId}/g{generation}/.
// assetVersionId keeps master replacements apart; g{generation} keeps two
// attempts at one version from ever writing the same object
// (hls_commit_video_job publishes only the committing generation's folder).
function renditionR2Prefix(attemptFolder, rendition) {
  const hdrSuffix = rendition.requiresToneMap ? "-tonemap" : rendition.hdrMode && rendition.hdrMode !== "sdr" ? `-${rendition.hdrMode}` : "";
  return `${attemptFolder}${rendition.codecFamily}-${rendition.resolutionLabel}${hdrSuffix}/`;
}

function renditionOutputDir(scratchDir, rendition) {
  const hdrSuffix = rendition.requiresToneMap ? "-tonemap" : "";
  return path.join(scratchDir, `${rendition.codecFamily}-${rendition.resolutionLabel}${hdrSuffix}`);
}

async function uploadDirectory(localDir, r2Prefix, lane) {
  const items = fs.readdirSync(localDir)
    .filter((name) => !fs.statSync(path.join(localDir, name)).isDirectory())
    .map((name) => ({
      key: `${r2Prefix}${name}`,
      file: path.join(localDir, name),
      contentType: name.endsWith(".m3u8") ? "application/x-mpegURL" : "video/mp4",
    }));
  await lane.uploadFiles(items);
}

function pickEncodeFn(rendition, sourceAnalysis, deps) {
  if (rendition.requiresToneMap) {
    return ({ sourcePath, outputDir, rendition: r }) => deps.tonemapHdrToSdrFn({ sourcePath, outputDir, rendition: r });
  }
  if (rendition.codecFamily === "avc") {
    return ({ sourcePath, outputDir, rendition: r }) => deps.encodeAvcRenditionFn({ sourcePath, outputDir, rendition: r });
  }
  return ({ sourcePath, outputDir, rendition: r }) => deps.encodeAv1RenditionFn({ sourcePath, outputDir, rendition: r, sourceAnalysis });
}

/**
 * Encode, quality-gate, validate, encrypt, and upload exactly one planned
 * rendition. Returns the row shape audio_visual_renditions expects.
 */
async function processOneRendition({ rendition, masterPath, scratchDir, audioVisualId, assetVersionId, sourceAnalysis, attemptFolder, deps }) {
  const outputDir = renditionOutputDir(scratchDir, rendition);
  fs.mkdirSync(outputDir, { recursive: true });

  const { scores } = await deps.runQualityGatedEncodeFn({
    rendition,
    sourcePath: masterPath,
    referencePath: masterPath,
    outputDir,
    encodeFn: pickEncodeFn(rendition, sourceAnalysis, deps),
    thresholds: DEFAULT_QUALITY_THRESHOLDS,
  });

  const validation = deps.validatePackagedOutputFn({ outputDir, expectedRendition: rendition, sourceAnalysis });
  if (!validation.passed) {
    const err = new Error(
      `Rendition ${rendition.resolutionLabel} (${rendition.codecFamily}) failed output validation: ` +
      validation.failures.map((f) => f.message).join("; ")
    );
    err.failureCategory = "OUTPUT_VALIDATION_FAILURE";
    throw err;
  }

  // Encryption stays keyed by audioVisualId (the stable UUID), never the
  // slug — a slug can be edited later (a title change, a dedup rename); the
  // encryption key for content already published must never shift under it.
  await deps.encryptRenditionSegmentsFn({
    sourceDir: outputDir, videoId: audioVisualId, assetVersionId,
    key: Buffer.from(deps.lane.encryption.key, "hex"), iv: Buffer.from(deps.lane.encryption.iv, "hex"),
  });

  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const rewritten = deps.rewritePlaylistForEncryptionFn(fs.readFileSync(playlistPath, "utf8"), "placeholder", "0".repeat(32));
  fs.writeFileSync(playlistPath, rewritten);

  const hlsPrefix = renditionR2Prefix(attemptFolder, rendition);
  await uploadDirectory(outputDir, hlsPrefix, deps.lane);

  return {
    asset_version_id: assetVersionId,
    codec_family: rendition.codecFamily,
    resolution_label: rendition.resolutionLabel,
    bit_depth: rendition.bitDepth,
    hdr_mode: rendition.requiresToneMap ? "sdr" : rendition.hdrMode,
    hls_prefix: hlsPrefix,
    vmaf_score: scores.vmaf ?? null,
    cambi_score: scores.cambi ?? null,
    ssim_score: scores.ssim ?? null,
  };
}

/**
 * @param {object} job - a claimed hls_transcode_jobs row (job_type='video')
 * @param {object} params
 * @param {Function} params.rpc - calls a fenced lane function (lane-db.js); required
 * @param {object} params.lease - this job's lease, named by every fenced write; required
 * @param {object} params.lane - this job's website session (lane-transfers.js); required
 * @param {object} [params] - every other engine-function override is test-only; real callers never need them
 */
export async function processVideoTranscodeJob(job, params) {
  if (!params?.rpc || !params?.lease || !params?.lane) {
    throw new Error("processVideoTranscodeJob: rpc, lease and lane are all required (see file header for why they're never defaulted)");
  }
  const deps = { ...DEFAULT_ENGINE_DEPS, ...params };
  const { id: jobId, asset_version_id: assetVersionId, generation, claim_token: claimToken } = job;

  if (!assetVersionId) {
    const err = new Error(`processVideoTranscodeJob: job ${jobId} has no asset_version_id`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }

  // The video's details, this attempt's folder and its content key, from the
  // website for this lease (a refused lease is LeaseLost).
  const opened = await deps.lane.open();
  const audioVisual = opened?.context;
  if (!audioVisual?.audio_visual_id || audioVisual.asset_version_id !== assetVersionId) {
    const err = new Error(`processVideoTranscodeJob: no video found for asset version ${assetVersionId}`);
    err.failureCategory = "INPUT_NOT_FOUND";
    throw err;
  }
  const audioVisualId = audioVisual.audio_visual_id;
  const attemptFolder = opened.prefix;
  if (!String(attemptFolder).endsWith(`/${assetVersionId}/g${generation}/`)) {
    throw new Error(`processVideoTranscodeJob: unexpected attempt folder ${attemptFolder}`);
  }
  // One scratch directory per lease (media-lane.js sweeps dead ones at boot).
  const scratchDir = deps.createJobWorkDirFn(jobId, claimToken);
  const masterPath = path.join(scratchDir, "master");

  try {
    await deps.lane.downloadSource(masterPath);

    const sourceAnalysis = await deps.runSourceAnalyzerFn(masterPath);
    const sourceCheck = deps.validateSourceAnalysisFn(sourceAnalysis);
    if (!sourceCheck.passed) {
      const err = new Error(`Source failed validation: ${sourceCheck.failures.map((f) => f.message).join("; ")}`);
      err.failureCategory = "VALIDATION_FAILURE";
      throw err;
    }
    const decodeCheck = await deps.runDecodeSanityCheckFn(masterPath);
    if (!decodeCheck.passed) {
      const err = new Error(`Source failed decode sanity check (exit ${decodeCheck.exitCode}): ${decodeCheck.stderrOutput.slice(-500)}`);
      err.failureCategory = "PROBE_FAILURE";
      throw err;
    }

    const complexityAnalysis = await deps.runSceneComplexityAnalyzerFn(masterPath, { durationSeconds: sourceAnalysis.durationSeconds });
    const renditions = deps.planRenditionsFn({ sourceAnalysis, complexityAnalysis });

    const sourceFileSizeBytes = fs.statSync(masterPath).size;
    const preflight = await deps.runStoragePreflightFn({
      sourceFileSizeBytes,
      codecFamilies: ["avc", "av1"],
      renditionCount: renditions.length,
      hasHdr: Boolean(sourceAnalysis.hdrMode && sourceAnalysis.hdrMode !== "sdr"),
    });
    if (preflight.verdict !== "ok") {
      const err = new Error(
        `Storage preflight insufficient: need ${preflight.requiredScratchBytes} bytes, have ${preflight.availableScratchBytes} (safety reserve ${preflight.safetyReserveBytes})`
      );
      err.failureCategory = "RESOURCE_EXHAUSTION";
      throw err;
    }

    const recorded = await deps.rpc("hls_video_job_encoding", {
      ...deps.lease,
      p_analysis: {
        source_analysis: sourceAnalysis,
        complexity_analysis: complexityAnalysis,
        storage_preflight: preflight,
        hdr_mode: sourceAnalysis.hdrMode && sourceAnalysis.hdrMode !== "sdr" ? sourceAnalysis.hdrMode : "sdr",
      },
    });
    if (!recorded) throw new LeaseLost(jobId);

    const renditionRows = [];
    for (const rendition of renditions) {
      const row = await processOneRendition({
        rendition, masterPath, scratchDir, audioVisualId, assetVersionId, sourceAnalysis, attemptFolder, deps,
      });
      renditionRows.push(row);
    }

    const peekStart = audioVisual?.peek_start_seconds ?? 0;
    const peekDuration = audioVisual?.peek_duration_seconds ?? 8;
    const peekLocalPath = path.join(scratchDir, "peek.mp4");
    await deps.generatePeekClipFn({
      sourcePath: masterPath,
      outputPath: peekLocalPath,
      startSeconds: peekStart,
      durationSeconds: peekDuration,
      sourceWidth: sourceAnalysis.width,
      sourceHeight: sourceAnalysis.height,
    });
    const peekR2Key = `${attemptFolder}peek.mp4`;
    await deps.lane.uploadFiles([{ key: peekR2Key, file: peekLocalPath, contentType: "video/mp4" }]);

    // Renditions, ready, promotion and job complete: one fenced transaction.
    // A failed attempt is recorded by media-lane.js (hls_fail_media_job),
    // which also fails the version once no attempt is left.
    const published = await deps.rpc("hls_commit_video_job", {
      ...deps.lease,
      p_renditions: renditionRows,
      p_peek_r2_key: peekR2Key,
    });
    if (!published?.committed) throw new LeaseLost(jobId);
  } finally {
    deps.cleanupJobWorkDirFn(jobId, claimToken);
  }
}
