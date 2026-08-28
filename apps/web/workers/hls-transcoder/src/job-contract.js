export const TRANSCODE_PROFILE_VERSION = 3;

export function assertClaimedJobContract(job) {
  if (!job?.id || !job?.claim_token || !job?.worker_id) {
    throw new Error("HLS job is missing its fenced claim identity");
  }

  const generation = Number(job.generation);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("HLS job has an invalid generation");
  }

  const targetProfile = Number(job.target_profile_version ?? TRANSCODE_PROFILE_VERSION);
  if (!Number.isSafeInteger(targetProfile) || targetProfile !== TRANSCODE_PROFILE_VERSION) {
    throw new Error(
      `Worker profile ${TRANSCODE_PROFILE_VERSION} cannot satisfy target profile ${targetProfile}`
    );
  }

  const base = String(job.base_hls_prefix || "");
  const output = String(job.hls_prefix || "");
  const expected = `${base}versions/g${generation}/`;
  if (!base.startsWith("hls/") || output !== expected) {
    throw new Error("HLS job output is not an immutable generation prefix");
  }
}
