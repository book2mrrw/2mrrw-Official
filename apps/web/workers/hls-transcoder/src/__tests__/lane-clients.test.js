import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { laneSession } from "../lane-transfers.js";
import { rpc } from "../lane-db.js";
import { LeaseLost } from "../media-lane.js";

const JOB = { id: "job-1", worker_id: "video-host-1", claim_token: "lease-1", generation: "3" };
const PREFIX = "2MRRW Studios/Music Videos/late-night/renditions/version-1/g3/";

/** The website and storage, recorded: answers by URL. */
function fakeNet(route) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method || "GET", body, headers: init.headers });
    return route(url, body, calls);
  };
  return { calls, fetchFn };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const OPENED = { prefix: PREFIX, encryption: { key: "0f".repeat(16), iv: "a5".repeat(16) }, context: { audio_visual_id: "video-1" }, source: { url: "https://r2.example/master?get" }, cache_control: "public, max-age=31536000, immutable" };

test("the session proves its lease on every call, and a refused lease is LeaseLost, not retried", async () => {
  const net = fakeNet(() => json(403, { error: "not the current holder of this job" }));
  const lane = laneSession({ lane: "video", job: JOB, fetchFn: net.fetchFn, env: { HLS_LANE_API_URL: "https://site.example/" } });
  await assert.rejects(() => lane.open(), (err) => err instanceof LeaseLost);
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].url, "https://site.example/api/hls/lane-transfers");
  assert.deepEqual(net.calls[0].body, { lane: "video", job_id: "job-1", worker_id: "video-host-1", lease_token: "lease-1", generation: 3 });
});

test("a track visual's lease is its lease_token, with no generation", async () => {
  const net = fakeNet(() => json(200, OPENED));
  const lane = laneSession({ lane: "track_visual", job: { id: "j", worker_id: "w", lease_token: "t" }, fetchFn: net.fetchFn, env: {} });
  await lane.open();
  assert.deepEqual(net.calls[0].body, { lane: "track_visual", job_id: "j", worker_id: "w", lease_token: "t" });
  assert.equal(net.calls[0].url, "https://www.2mrrw.com/api/hls/lane-transfers");
});

test("a website hiccup is retried; open() exposes the folder, content key and context", async () => {
  const net = fakeNet((url, body, calls) => (calls.length === 1 ? json(503, { error: "busy" }) : json(200, OPENED)));
  const lane = laneSession({ lane: "video", job: JOB, fetchFn: net.fetchFn, env: {} });
  await lane.open();
  assert.equal(net.calls.length, 2);
  assert.equal(lane.prefix, PREFIX);
  assert.deepEqual(lane.encryption, OPENED.encryption);
  assert.deepEqual(lane.context, OPENED.context);
});

test("uploads go in signed batches, each PUT with exactly the headers it was signed for; the source downloads to a file", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lane-clients-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const items = Array.from({ length: 501 }, (_, i) => {
    const file = path.join(dir, `seg_${i}.ts`);
    fs.writeFileSync(file, `segment ${i}`);
    return { key: `${PREFIX}avc-1080p/seg_${i}.ts`, file, contentType: "video/mp2t" };
  });
  const net = fakeNet((url, body) => {
    if (url.endsWith("/api/hls/lane-transfers")) {
      return json(200, { ...OPENED, uploads: (body.uploads || []).map((u) => ({ key: u.key, url: `https://r2.example/${u.key}?put`, content_type: u.content_type })) });
    }
    if (url.includes("?get")) return new Response("master bytes", { status: 200 });
    return new Response(null, { status: 200 });
  });
  const lane = laneSession({ lane: "video", job: JOB, fetchFn: net.fetchFn, env: {} });
  await lane.uploadFiles(items);
  const asks = net.calls.filter((c) => c.url.endsWith("/api/hls/lane-transfers"));
  assert.deepEqual(asks.map((c) => c.body.uploads.length), [500, 1], "two signed batches");
  const puts = net.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 501);
  assert.deepEqual(puts[0].headers, { "Content-Type": "video/mp2t", "Cache-Control": "public, max-age=31536000, immutable" });
  assert.equal(String(puts[42].body), "segment 42");

  const master = path.join(dir, "master");
  assert.equal(await lane.downloadSource(master), "master bytes".length);
  assert.equal(fs.readFileSync(master, "utf8"), "master bytes");
});

test("published() is best-effort: a refusal never fails a committed job", async () => {
  const net = fakeNet(() => json(403, { error: "not a job this worker just published" }));
  const lane = laneSession({ lane: "vault_video", job: JOB, fetchFn: net.fetchFn, env: {} });
  assert.equal(await lane.published(), false);
  assert.equal(net.calls[0].body.published, true);
});

test("lane functions are called by name with named arguments; a claim returns its row or null", async () => {
  const seen = [];
  const query = (rows) => async (text, values) => { seen.push({ text, values }); return { rows }; };
  assert.equal(await rpc("hls_claim_media_job", { p_worker_id: "w", p_job_type: "video" }, { query: query([{ id: null }]) }), null);
  assert.deepEqual(await rpc("hls_claim_media_job", { p_worker_id: "w", p_job_type: "video" }, { query: query([{ id: "job-1" }]) }), { id: "job-1" });
  assert.equal(seen[0].text, "select * from public.hls_claim_media_job(p_worker_id => $1, p_job_type => $2)");
  assert.equal(await rpc("hls_commit_video_job", { p_job_id: "j", p_renditions: [{ a: 1 }], p_peek_r2_key: null }, { query: query([{ result: { committed: true } }]) }).then((r) => r.committed), true);
  assert.equal(seen.at(-1).text, "select public.hls_commit_video_job(p_job_id => $1, p_renditions => $2, p_peek_r2_key => $3) as result");
  assert.deepEqual(seen.at(-1).values, ["j", '[{"a":1}]', null], "objects travel as JSON");
  await assert.rejects(() => rpc("drop table x; --", {}, { query: query([]) }), /not a lane function/);
  await assert.rejects(() => rpc("hls_claim_media_job", { "x) or 1=1 --": 1 }, { query: query([]) }), /bad argument names/);
});

test("a source that no longer exists fails as INPUT_NOT_FOUND, once, without retries", async () => {
  const net = fakeNet((url) => (url.endsWith("/api/hls/lane-transfers") ? json(200, OPENED) : new Response("NoSuchKey", { status: 404 })));
  const lane = laneSession({ lane: "audio", job: JOB, fetchFn: net.fetchFn, env: {} });
  await assert.rejects(() => lane.downloadSource(path.join(os.tmpdir(), "never-written")), (err) => err.failureCategory === "INPUT_NOT_FOUND");
  assert.equal(net.calls.filter((c) => c.url.includes("?get")).length, 1);
});
