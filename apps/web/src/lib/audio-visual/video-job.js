/**
 * The hls_transcode_jobs row that queues an uploaded Audio Visualz master —
 * a music video, short film or documentary — for the video lane
 * (job_type 'video', workers/hls-transcoder/src/workers/video-worker.js).
 *
 * The job table gives every row a slug and an hls/ prefix: slug is NOT NULL,
 * (slug, track_slug) is unique across every lane, and the trigger
 * trg_hls_prepare_job_generation derives each attempt's versions/g{n}/ prefix
 * from hls_prefix, refusing anything that is not hls/... . The asset version
 * is the identity: one job per uploaded master, and a slug containing "/"
 * can never collide with a release's. The worker writes the renditions under
 * the video's own 2MRRW Studios folder; this prefix only names the job.
 */
import { VIDEO_RENDITIONS } from "@/lib/hls/video-renditions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function videoTranscodeJobRow({ assetVersionId, sourceKey, queuedBy = null }) {
  if (!UUID.test(String(assetVersionId ?? ""))) throw new Error("videoTranscodeJobRow: an asset version id is required");
  if (!sourceKey) throw new Error("videoTranscodeJobRow: a source key is required");
  return {
    job_type: "video",
    slug: `audio-visual/${assetVersionId}`,
    release_type: "audio_visual",
    asset_version_id: assetVersionId,
    source_key: sourceKey,
    hls_prefix: `hls/audio-visual/${assetVersionId}/`,
    // The worker plans the real ladder from the master; this is the full set.
    bitrates: [...VIDEO_RENDITIONS],
    status: "pending",
    queued_by: queuedBy,
  };
}
