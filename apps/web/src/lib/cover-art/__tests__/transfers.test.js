import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";

// next/server has no ESM entry; resolve it like the ticket route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'), import.meta.url);

// The worker's only credential is the lease it holds; the website signs its links.
const JOB = "11111111-2222-4333-8444-555555555555";
const LEASE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let row;
const signed = [];

mock.module("next/server", { namedExports: { NextResponse: { json: (body, init) => Response.json(body, init) } } });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => ({
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) };
    return query;
  },
}) } });
mock.module("@/lib/storage/r2", { namedExports: {
  createR2SignedGetUrl: async (key, ttl) => { signed.push({ get: key, ttl }); return `https://r2.example/${key}?get`; },
  createR2SignedPutUrl: async (key, type, ttl, options) => { signed.push({ put: key, type, ttl, cacheControl: options?.cacheControl }); return `https://r2.example/${key}?put`; },
} });

const { laneTransfers, renditionKey } = await import("../transfers.js");
const { POST } = await import("../../../app/api/cover-art/transfers/route.js");
const { classifyRouteAccess, RouteAccessClass } = await import("../../auth/route-access-policy.js");

const holding = () => ({ source_key: "videos/singles/w2d/w2d.mp4", source_etag: "9f86d081884c7d65", status: "processing", lease_token: LEASE });

test("the current holder gets a read link for its original and write links under cover-art/ only", async () => {
  row = holding();
  signed.length = 0;
  const { status, body } = await laneTransfers({ id: JOB, leaseToken: LEASE, renditions: ["square-720", "tall", "square-720"] });
  assert.equal(status, 200);
  assert.equal(body.source.url, "https://r2.example/videos/singles/w2d/w2d.mp4?get");
  assert.deepEqual(body.uploads.map((u) => u.key), [
    "cover-art/singles/w2d/9f86d081884c7d65/square-720.mp4",
    "cover-art/singles/w2d/9f86d081884c7d65/tall.mp4",
  ]);
  assert.ok(signed.filter((s) => s.put).every((s) => s.type === "video/mp4" && s.cacheControl === "public, max-age=31536000, immutable" && s.ttl <= 900));
});

test("no lease, a stale lease, a finished job or an unknown rendition gets nothing", async () => {
  row = holding();
  signed.length = 0;
  assert.equal((await laneTransfers({ id: JOB, leaseToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).status, 403);
  assert.equal((await laneTransfers({ id: JOB })).status, 400);
  assert.equal((await laneTransfers({ id: JOB, leaseToken: LEASE, renditions: ["../../videos/x"] })).status, 400);
  assert.equal((await laneTransfers({ id: JOB, leaseToken: LEASE, renditions: ["square-720", "a", "b", "c", "d", "e", "f", "g", "h"] })).status, 400);
  row = { ...holding(), status: "ready" };
  assert.equal((await laneTransfers({ id: JOB, leaseToken: LEASE })).status, 403);
  row = null;
  assert.equal((await laneTransfers({ id: JOB, leaseToken: LEASE })).status, 403);
  assert.deepEqual(signed, [], "nothing is signed for anyone but the holder");
});

test("rendition keys mirror the original's folder under cover-art/", () => {
  assert.equal(renditionKey("videos/albums/love-hz/cover.mp4", '"ABC-12"', "square-480"), "cover-art/albums/love-hz/abc12/square-480.mp4");
});

test("the route answers the worker, and is a machine route outside the consumer sign-in gate", async () => {
  row = holding();
  const post = (body) => POST(new Request("https://www.2mrrw.com/api/cover-art/transfers", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  assert.equal((await post({ id: JOB, lease_token: LEASE, renditions: ["square-480"] })).status, 200);
  assert.equal((await post({ id: JOB, lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).status, 403);
  assert.equal((await post("not json")).status, 400);
  assert.equal(classifyRouteAccess("/api/cover-art/transfers", "POST"), RouteAccessClass.SERVICE_INTERNAL);
  assert.notEqual(classifyRouteAccess("/api/cover-art/transfers", "GET"), RouteAccessClass.SERVICE_INTERNAL);
});
