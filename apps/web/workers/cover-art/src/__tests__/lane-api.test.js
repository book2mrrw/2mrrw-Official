import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { download, transfers, upload } from "../lane-api.js";

// A stand-in for the website's transfers route and the bucket's signed links.
test("the lane asks the website for its job's links, reads the original and writes with the signed headers", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lane-api-"));
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = Buffer.alloc(0);
    for await (const chunk of req) body = Buffer.concat([body, chunk]);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/api/cover-art/transfers") {
      const { id, lease_token, renditions } = JSON.parse(body);
      if (lease_token !== "lease") { res.writeHead(403).end("no"); return; }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        source: { url: `${base}/original`, etag: "e1" },
        uploads: renditions.map((r) => ({ id: r, key: `cover-art/${id}/${r}.mp4`, url: `${base}/put/${r}` })),
        contentType: "video/mp4", cacheControl: "public, max-age=31536000, immutable",
      }));
    } else if (req.url === "/original") {
      res.writeHead(200, { etag: '"e1"' }).end("original-bytes");
    } else if (req.url.startsWith("/put/")) {
      res.writeHead(200).end();
    } else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.COVER_ART_API_URL = `http://127.0.0.1:${server.address().port}/`;
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.COVER_ART_API_URL; });

  const job = { id: "job", lease_token: "lease" };
  const first = await transfers(job);
  assert.equal(first.uploads.length, 0);
  assert.equal(await download(first.source.url, join(dir, "source")), "e1");
  assert.equal(readFileSync(join(dir, "source"), "utf8"), "original-bytes");

  const links = await transfers(job, ["square-720"]);
  writeFileSync(join(dir, "r.mp4"), "rendition");
  assert.equal(await upload(links.uploads[0].url, join(dir, "r.mp4"), links), 9);
  const put = seen.find((r) => r.method === "PUT");
  assert.equal(put.headers["content-type"], "video/mp4");
  assert.equal(put.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(put.body.toString(), "rendition");

  await assert.rejects(transfers({ id: "job", lease_token: "stale" }), /transfers 403/);
});
