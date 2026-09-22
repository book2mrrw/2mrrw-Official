import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let denied, databaseCalls, signs, failDatabase, privateSafe;
const id = "11111111-1111-4111-8111-111111111111";
const row = () => ({ id, slug: "private-project", status: "unrelzd", release_type: "album", content_kind: "music",
  storage_scope: privateSafe ? "private" : "public", cover_art_r2_key: "private/cover.jpg", metadata: { draft_title: "Private" } });
mock.module("../admin-http.js", { namedExports: {
  authorizeBroadcastAdmin: async () => denied ? { denial: Response.json({ error: "Denied" }, { status: 403 }) } : { actorId: id, id },
  broadcastResponse: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }),
} });
mock.module("../../supabase/admin.js", { namedExports: { getAdminClient: () => ({ from(table) {
  databaseCalls++;
  const result = () => failDatabase ? { error: new Error("storage secret") } : { data: table === "releases" ? [row()] : [], count: 3 };
  const query = { select() { return this; }, eq() { return this; }, in() { return this; }, is() { return this; }, order() { return this; }, range() { return this; },
    maybeSingle: async () => failDatabase ? result() : { data: row() }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
  return query;
} }) } });
mock.module("../../storage/r2.js", { namedExports: {
  createR2SignedGetUrl: async (key, ttl, options) => { signs++; assert.equal(key, "private/cover.jpg"); assert.equal(ttl, 60); assert.equal(options.storageScope, "private"); return "https://storage.test/signed-secret"; },
  discoverFileByExtensions: async () => null,
} });
mock.module("../../server/r2-stream-proxy.js", { namedExports: { proxySignedR2Get: async (req, url, options) => {
  assert.equal(options.opaqueErrors, true); assert.equal(options.cacheControl, "private, no-store");
  return new Response("image", { headers: { "Cache-Control": options.cacheControl } });
} } });
const { GET: catalog } = await import("../../../app/api/admin/broadcast/projects/route.js");
const { GET: artwork } = await import("../../../app/api/admin/broadcast/projects/[kind]/[id]/artwork/route.js");
beforeEach(() => { denied = false; databaseCalls = 0; signs = 0; failDatabase = false; privateSafe = true; });
const req = () => new Request("https://www.2mrrw.com/api/admin/broadcast/projects?library=unrelzd");
const context = { params: Promise.resolve({ kind: "release", id }) };

test("Admin denial prevents all project enumeration and artwork signing", async () => {
  denied = true;
  assert.equal((await catalog(req())).status, 403); assert.equal((await artwork(req(), context)).status, 403);
  assert.equal(databaseCalls, 0); assert.equal(signs, 0);
});
test("catalog projects have canonical identity without secret keys and use no-store", async () => {
  const response = await catalog(req());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.projects[0].id, id); assert.equal(body.projects[0].trackCount, 3);
  assert.equal(JSON.stringify(body).includes("private/cover.jpg"), false);
});
test("private artwork is proxied after private-storage validation", async () => {
  const response = await artwork(req(), context);
  assert.equal(response.status, 200); assert.equal(signs, 1); assert.equal(await response.text(), "image");
  privateSafe = false;
  assert.equal((await artwork(req(), context)).status, 503); assert.equal(signs, 1);
});
test("bad pagination and database failures do not return partial catalog data or internals", async () => {
  assert.equal((await catalog(new Request("https://www.2mrrw.com/api/admin/broadcast/projects?page=-1"))).status, 400);
  assert.equal(databaseCalls, 0);
  failDatabase = true;
  const response = await catalog(req()); assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("secret"), false);
});
