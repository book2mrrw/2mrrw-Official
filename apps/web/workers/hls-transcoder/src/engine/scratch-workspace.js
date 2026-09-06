/**
 * Job-scoped scratch work directories on the video lane's /data volume:
 * /data/jobs/{jobId}/{attemptId}/ — never a shared temp directory across
 * jobs. This is what makes cleanup, lease recovery, resource accounting, and
 * failure diagnosis safe: deleting one job's directory can never touch
 * another job's in-progress files.
 *
 * The scratch root is read from VIDEO_SCRATCH_ROOT per-call (not frozen at
 * module load) so tests can point it at a temp directory without needing to
 * re-import this module.
 */
import fs from "fs";
import path from "path";

function scratchRoot() {
  return process.env.VIDEO_SCRATCH_ROOT || "/data/jobs";
}

export function jobWorkDir(jobId, attemptId) {
  if (!jobId || !attemptId) throw new Error("jobWorkDir: jobId and attemptId are both required");
  return path.join(scratchRoot(), String(jobId), String(attemptId));
}

/** Create (or reuse, if it already exists) the job's scratch directory. */
export function createJobWorkDir(jobId, attemptId) {
  const dir = jobWorkDir(jobId, attemptId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove one job's scratch directory. Never throws if it's already gone. */
export function cleanupJobWorkDir(jobId, attemptId) {
  const dir = jobWorkDir(jobId, attemptId);
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Boot-time orphan sweep: remove any top-level job directory whose jobId no
 * longer maps to a job this worker considers actively owned. `isJobStillActive`
 * is an injected async predicate (typically backed by a DB query for
 * status='processing' rows) — kept out of this module so it stays a pure
 * filesystem utility, easily testable without a real database.
 */
export async function cleanupOrphanedJobDirs(isJobStillActive) {
  const root = scratchRoot();
  if (!fs.existsSync(root)) return { scanned: 0, removed: [] };

  const jobIds = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const removed = [];
  for (const jobId of jobIds) {
    const stillActive = await isJobStillActive(jobId);
    if (!stillActive) {
      fs.rmSync(path.join(root, jobId), { recursive: true, force: true });
      removed.push(jobId);
    }
  }

  return { scanned: jobIds.length, removed };
}
