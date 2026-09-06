/**
 * Video transcode processor — the job_type='video' dispatch target from
 * index.js's processJob().
 *
 * Scaffolding only. Real VIDEO_TRANSCODE encoding (the Audio Visual rendition
 * ladder, source-aware scaling, Peek derivation, etc.) lands in a later slice
 * of the media-foundation implementation plan, once the Fly.io worker-lane
 * separation and lease/heartbeat model this dispatch split enables are in
 * place. This file exists now so the job_type branch in index.js is real and
 * testable today — a video job is routed here and only here; it can never
 * fall through to transcoder.js's audio-only encoder, now or later.
 */
export async function processVideoTranscodeJob(job) {
  throw new Error(
    `VIDEO_TRANSCODE is not implemented yet (job ${job.id}) — job_type='video' jobs ` +
    "are dispatched to this file but real encoding lands in a later Audio Visual slice."
  );
}
