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
 * and audio_visual_renditions rows, which is why this file has its own
 * tiny completion write rather than reusing db.js's markJobComplete.
 *
 * NOT YET CONFIRMED LIVE: every engine this wires together was confirmed
 * against the real production machine in its own slice, but this specific
 * end-to-end sequence has not been run against a real job — no Docker/
 * Linux runtime was available to do that from where this was written. Per
 * this project's standing policy, confirm this against a real upload
 * before trusting it in production, the same way every prior slice was
 * confirmed.
 *
 * dbClient/downloadStreamFn/uploadFn are REQUIRED deps, never defaulted to
 * the real db.js/r2.js singletons — exactly the reason publication-
 * authority.js's own header gives for the same choice: importing db.js (or
 * r2.js) throws at *import time* if the real env vars aren't set, which
 * would make this whole file unsafe to even import in a test file.
 * video-worker.js is the one real caller and passes the real modules in.
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
import { promoteAssetVersion } from "./engine/publication-authority.js";
import { audioVisualR2FolderPath } from "./engine/r2-paths.js";

// Starting quality-gate policy, not final — mirrors rendition-planner.js's
// own "documented starting policy, calibrate against real representative
// masters later" stance. VMAF ~93 and SSIM ~0.95 are conventional
// "visually lossless for streaming" floors; CAMBI ~8 is a conservative
// banding ceiling (0 = no banding).
const DEFAULT_QUALITY_THRESHOLDS = { minVmaf: 93, maxCambi: 8, minSsim: 0.95 };

// Every engine-function default below is safe to import unconditionally
// (no env-var-gated singleton behind any of them) — only dbClient/
// downloadStreamFn/uploadFn are excluded and required from the caller.
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
  promoteAssetVersionFn: promoteAssetVersion,
  createJobWorkDirFn: createJobWorkDir,
  cleanupJobWorkDirFn: cleanupJobWorkDir,
};

// Nested under the confirmed "2MRRW Studios/{Content-Type Folder}/{slug}/"
// (or .../Seriez/{seriezSlug}/{episodeSlug}/) convention — assetVersionId
// keeps multiple master replacements' renditions from ever colliding under
// the same slug folder.
function renditionR2Prefix(baseFolder, assetVersionId, rendition) {
  const hdrSuffix = rendition.requiresToneMap ? "-tonemap" : rendition.hdrMode && rendition.hdrMode !== "sdr" ? `-${rendition.hdrMode}` : "";
  return `${baseFolder}renditions/${assetVersionId}/${rendition.codecFamily}-${rendition.resolutionLabel}${hdrSuffix}/`;
}

function renditionOutputDir(scratchDir, rendition) {
  const hdrSuffix = rendition.requiresToneMap ? "-tonemap" : "";
  return path.join(scratchDir, `${rendition.codecFamily}-${rendition.resolutionLabel}${hdrSuffix}`);
}

async function downloadMasterToLocalFile(sourceKey, destPath, downloadStreamFn) {
  const stream = await downloadStreamFn(sourceKey);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    stream.pipe(out);
    stream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
  });
}

async function uploadDirectory(localDir, r2Prefix, uploadFn) {
  const entries = fs.readdirSync(localDir);
  for (const name of entries) {
    const localPath = path.join(localDir, name);
    if (fs.statSync(localPath).isDirectory()) continue;
    const contentType = name.endsWith(".m3u8") ? "application/x-mpegURL" : "video/mp4";
    await uploadFn(`${r2Prefix}${name}`, fs.readFileSync(localPath), contentType);
  }
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
async function processOneRendition({ rendition, masterPath, scratchDir, audioVisualId, assetVersionId, sourceAnalysis, baseFolder, deps }) {
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
  await deps.encryptRenditionSegmentsFn({ sourceDir: outputDir, videoId: audioVisualId, assetVersionId });

  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const rewritten = deps.rewritePlaylistForEncryptionFn(fs.readFileSync(playlistPath, "utf8"), "placeholder", "0".repeat(32));
  fs.writeFileSync(playlistPath, rewritten);

  const hlsPrefix = renditionR2Prefix(baseFolder, assetVersionId, rendition);
  await uploadDirectory(outputDir, hlsPrefix, deps.uploadFn);

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
 * @param {object} params.dbClient - required, never defaulted (see file header)
 * @param {Function} params.downloadStreamFn - required, never defaulted (see file header)
 * @param {Function} params.uploadFn - required, never defaulted (see file header)
 * @param {object} [params] - every other engine-function override is test-only; real callers never need them
 */
export async function processVideoTranscodeJob(job, params) {
  if (!params?.dbClient || !params?.downloadStreamFn || !params?.uploadFn) {
    throw new Error("processVideoTranscodeJob: dbClient, downloadStreamFn, and uploadFn are all required (see file header for why they're never defaulted)");
  }
  const deps = { ...DEFAULT_ENGINE_DEPS, ...params };
  const { id: jobId, source_key: sourceKey, asset_version_id: assetVersionId, attempt_count: attemptCount = 0 } = job;

  if (!assetVersionId) {
    const err = new Error(`processVideoTranscodeJob: job ${jobId} has no asset_version_id`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }

  const { data: assetVersion, error: avErr } = await deps.dbClient
    .from("audio_visual_asset_versions")
    .select("id, audio_visual_id")
    .eq("id", assetVersionId)
    .single();
  if (avErr || !assetVersion) {
    const err = new Error(`processVideoTranscodeJob: could not load asset version ${assetVersionId}: ${avErr?.message}`);
    err.failureCategory = "INPUT_NOT_FOUND";
    throw err;
  }
  const audioVisualId = assetVersion.audio_visual_id;

  const { data: audioVisual, error: videoErr } = await deps.dbClient
    .from("audio_visuals")
    .select("peek_start_seconds, peek_duration_seconds, slug, video_type, seriez_id")
    .eq("id", audioVisualId)
    .single();
  if (videoErr || !audioVisual) {
    const err = new Error(`processVideoTranscodeJob: could not load audio_visuals row ${audioVisualId}: ${videoErr?.message}`);
    err.failureCategory = "INPUT_NOT_FOUND";
    throw err;
  }

  let seriezSlug = null;
  if (audioVisual.seriez_id) {
    const { data: seriez } = await deps.dbClient.from("audio_visual_seriez").select("slug").eq("id", audioVisual.seriez_id).single();
    seriezSlug = seriez?.slug || null;
  }
  const baseFolder = audioVisualR2FolderPath({
    videoType: audioVisual.video_type,
    slug: audioVisual.slug,
    seriezSlug,
    episodeSlug: seriezSlug ? audioVisual.slug : null,
  });

  const scratchDir = deps.createJobWorkDirFn(jobId, attemptCount + 1);
  const masterPath = path.join(scratchDir, "master");

  try {
    await downloadMasterToLocalFile(sourceKey, masterPath, deps.downloadStreamFn);

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

    await deps.dbClient.from("audio_visual_asset_versions").update({
      status: "encoding",
      source_analysis: sourceAnalysis,
      complexity_analysis: complexityAnalysis,
      storage_preflight: preflight,
      hdr_mode: sourceAnalysis.hdrMode && sourceAnalysis.hdrMode !== "sdr" ? sourceAnalysis.hdrMode : "sdr",
    }).eq("id", assetVersionId);

    const renditionRows = [];
    for (const rendition of renditions) {
      const row = await processOneRendition({
        rendition, masterPath, scratchDir, audioVisualId, assetVersionId, sourceAnalysis, baseFolder, deps,
      });
      renditionRows.push(row);
    }

    if (renditionRows.length > 0) {
      const { error: renditionErr } = await deps.dbClient.from("audio_visual_renditions").insert(renditionRows);
      if (renditionErr) {
        const err = new Error(`inserting audio_visual_renditions: ${renditionErr.message}`);
        err.failureCategory = "VALIDATION_FAILURE";
        throw err;
      }
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
    const peekR2Key = `${baseFolder}peek/${assetVersionId}.mp4`;
    await deps.uploadFn(peekR2Key, fs.readFileSync(peekLocalPath), "video/mp4");

    await deps.dbClient.from("audio_visual_asset_versions").update({
      status: "ready",
      peek_r2_key: peekR2Key,
    }).eq("id", assetVersionId);

    await deps.promoteAssetVersionFn({ audioVisualId, assetVersionId, dbClient: deps.dbClient });

    const { error: jobErr } = await deps.dbClient.from("hls_transcode_jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    if (jobErr) throw new Error(`marking video job complete: ${jobErr.message}`);
  } catch (err) {
    await deps.dbClient.from("audio_visual_asset_versions")
      .update({ status: "failed" })
      .eq("id", assetVersionId)
      .then(() => {}, () => {});
    throw err;
  } finally {
    deps.cleanupJobWorkDirFn(jobId, attemptCount + 1);
  }
}
