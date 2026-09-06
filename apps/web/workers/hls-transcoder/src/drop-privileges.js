/**
 * Drop root privileges to the non-root "worker" user (uid 1001, gid 999 —
 * matching the Dockerfile's `useradd -r -u 1001 worker`), after chowning any
 * paths that need to be writable by that user first.
 *
 * Needed because a freshly-mounted Fly Volume is owned by root:root — the
 * video lane's /data mount can't be written to by a non-root process until
 * something with root privileges chowns it once. The container now starts
 * as root (see Dockerfile) so this can run; every other line of actual
 * worker logic (polling, FFmpeg, file I/O) still executes as the same
 * non-root user as before — this is a mechanism change, not a security
 * posture change. Call this once, immediately, before any other work.
 */
import fs from "fs";

const WORKER_UID = 1001;
const WORKER_GID = 999;

export function dropPrivilegesIfRoot(chownPaths = []) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return;

  for (const path of chownPaths) {
    if (fs.existsSync(path)) {
      fs.chownSync(path, WORKER_UID, WORKER_GID);
    }
  }

  process.setgid("worker");
  process.setuid("worker");
}
