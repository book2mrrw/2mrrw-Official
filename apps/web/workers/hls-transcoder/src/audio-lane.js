/**
 * One song through the keyless audio lane: encode with transcoder.js (today's
 * audio encoder, unchanged), then publish through the fenced
 * hls_commit_transcode_job named by this job's lease — the manifest, its
 * generation made active and the job complete in one transaction. A refused
 * commit means another worker now holds the job: LeaseLost, nothing written.
 * Then the website refreshes its manifest cache for the song.
 *
 * The old poster branch (video bitrates on an audio job) is gone: job_type
 * 'audio' rows only ever carry AUDIO_RENDITIONS, so it never ran.
 */

import { logger } from "./logger.js";
import { transcode } from "./transcoder.js";
import { LeaseLost } from "./media-lane.js";

export async function processAudioTranscodeJob(job, { rpc, lease, lane, transcodeFn = transcode }) {
  if (!rpc || !lease || !lane) throw new Error("processAudioTranscodeJob: rpc, lease and lane are required");
  const manifest = await transcodeFn({ job, lane });
  const published = await rpc("hls_commit_transcode_job", { ...lease, p_manifest: manifest });
  if (!published?.committed) throw new LeaseLost(job.id);
  await lane.published();
  logger.info("song published", { jobId: job.id, slug: job.slug, trackSlug: job.track_slug, generation: published.generation });
  return published;
}
