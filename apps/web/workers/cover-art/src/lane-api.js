/**
 * Storage through the website (POST /api/cover-art/transfers): the lane holds
 * no storage credential. For the job it currently holds, the website signs a
 * read link for the original and write links for that job's renditions under
 * cover-art/ — the lease token from claim_cover_art_job is the only proof.
 */

import { createWriteStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MINUTE = 60_000;
const apiBase = () => (process.env.COVER_ART_API_URL || "https://www.2mrrw.com").replace(/\/+$/, "");

/** The job's links: always the original's read link; write links for `renditions`. */
export async function transfers(job, renditions = []) {
  const res = await fetch(`${apiBase()}/api/cover-art/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: job.id, lease_token: job.lease_token, renditions }),
    signal: AbortSignal.timeout(MINUTE / 2),
  });
  if (!res.ok) throw new Error(`transfers ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Download the original to `file`; returns its ETag. */
export async function download(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * MINUTE) });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return String(res.headers.get("etag") || "").replace(/"/g, "");
}

/** Upload a rendition with exactly the headers its link was signed for; returns its size. */
export async function upload(url, file, { contentType, cacheControl }) {
  const body = readFileSync(file);
  const headers = { "Content-Type": contentType };
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  const res = await fetch(url, { method: "PUT", body, headers, signal: AbortSignal.timeout(10 * MINUTE) });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return body.length;
}
