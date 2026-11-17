import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextResponse } from "next/server.js";

const root = path.resolve(import.meta.dirname, "../../../..");

test("a relative site path cannot be redirected to as-is (why the mixtape covers 500'd)", () => {
  assert.throws(() => NextResponse.redirect("/images/albums/ad.jpg", 302));
  const base = new URL("https://www.2mrrw.com/api/media/visual?releaseType=mixtape&slug=ad");
  const response = NextResponse.redirect(new URL("/images/albums/ad.jpg", base), 302);
  assert.equal(response.headers.get("location"), "https://www.2mrrw.com/images/albums/ad.jpg");
  const absolute = NextResponse.redirect(new URL("https://pub.r2.dev/videos/w2d.mp4", base), 302);
  assert.equal(absolute.headers.get("location"), "https://pub.r2.dev/videos/w2d.mp4");
});

test("/api/media/visual resolves its redirect target against the request URL", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/media/visual/route.js"), "utf8");
  assert.match(route, /NextResponse\.redirect\(new URL\(resolved\.url, req\.nextUrl\),/);
  assert.doesNotMatch(route, /NextResponse\.redirect\(resolved\.url\b/);
});
