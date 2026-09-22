import test from "node:test";
import assert from "node:assert/strict";

// Isolated Node test process, fake credentials only. Signing itself makes no network requests.
process.env.CLOUDFLARE_R2_ENDPOINT = "https://scope-test.invalid";
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-access-key";
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret-key";
process.env.CLOUDFLARE_R2_BUCKET_NAME = "public-test";
process.env.CLOUDFLARE_R2_PRIVATE_BUCKET_NAME = "private-test";
const r2 = await import("../r2.js");
const multipart = await import("../r2-multipart.js");
const privateOptions = { storageScope: "private" };

test("real SDK signing binds private GET/PUT to private bucket and requested expiry", async () => {
  for (const signed of [await r2.createR2SignedGetUrl("audio/master.flac", 60, privateOptions), await r2.createR2SignedPutUrl("audio/master.flac", "audio/flac", 60, privateOptions)]) {
    const url = new URL(signed);
    assert.ok(url.hostname.startsWith("private-test.") || url.pathname.startsWith("/private-test/"));
    assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
    assert.ok(url.searchParams.has("X-Amz-Signature"));
  }
  const publicUrl = new URL(await r2.createR2SignedGetUrl("audio/master.flac", 60));
  assert.ok(publicUrl.hostname.startsWith("public-test.") || publicUrl.pathname.startsWith("/public-test/"));
});

test("HEAD, metadata, list, copy, and deletion retain the same private bucket", async () => {
  const commands = [];
  const send = r2.r2Client.send;
  r2.r2Client.send = async (command) => { commands.push(command.input); return { ContentLength: 100, ContentType: "audio/flac", Contents: [] }; };
  try {
    assert.equal(await r2.headR2ObjectKey("audio/master.flac", privateOptions), true);
    assert.equal((await r2.getR2ObjectMetadata("audio/master.flac", privateOptions)).contentLength, 100);
    await r2.listR2Objects("audio/", privateOptions);
    await r2.copyR2Object("audio/old master.flac", "audio/new.flac", privateOptions);
    await r2.deleteR2Object("audio/old master.flac", privateOptions);
    assert.equal(commands.length, 5);
    assert.ok(commands.every((command) => command.Bucket === "private-test"));
    assert.equal(commands[3].CopySource, "private-test/audio/old%20master.flac");
  } finally { r2.r2Client.send = send; }
});

test("invalid private configuration never falls back during signing or object operations", async () => {
  const prior = process.env.CLOUDFLARE_R2_PRIVATE_BUCKET_NAME;
  delete process.env.CLOUDFLARE_R2_PRIVATE_BUCKET_NAME;
  try {
    await assert.rejects(r2.createR2SignedGetUrl("audio/master", 60, privateOptions), /distinct/);
    await assert.rejects(r2.createR2SignedPutUrl("audio/master", "audio/flac", 60, privateOptions), /distinct/);
    await assert.rejects(r2.headR2ObjectKey("audio/master", privateOptions), /distinct/);
    await assert.rejects(r2.getR2ObjectMetadata("audio/master", privateOptions), /distinct/);
    await assert.rejects(r2.listR2Objects("audio/", privateOptions), /distinct/);
    await assert.rejects(r2.copyR2Object("audio/master", "audio/new", privateOptions), /distinct/);
    await assert.rejects(r2.deleteR2Object("audio/master", privateOptions), /distinct/);
    await assert.rejects(multipart.createMultipartUpload("audio/master", "audio/flac", privateOptions), /distinct/);
    await assert.rejects(multipart.getMultipartPartUploadUrl("audio/master", "upload", 1, 60, privateOptions), /distinct/);
    await assert.rejects(multipart.completeMultipartUpload("audio/master", "upload", [{ partNumber: 1, etag: "etag" }], privateOptions), /distinct/);
    await assert.rejects(multipart.abortMultipartUpload("audio/master", "upload", privateOptions), /distinct/);
    await assert.rejects(multipart.cleanupStaleMultipartUploads("audio/", 1000, privateOptions), /distinct/);
    assert.throws(() => r2.getPublicR2Url("audio/master", privateOptions), /cannot use/);
  } finally { process.env.CLOUDFLARE_R2_PRIVATE_BUCKET_NAME = prior; }
});

test("multipart creation, signing, completion, and cleanup use one private scope", async () => {
  const send = r2.r2Client.send;
  const commands = [];
  r2.r2Client.send = async (command) => {
    commands.push(command.input);
    return { UploadId: "upload", ETag: "etag", Uploads: command.constructor.name === "ListMultipartUploadsCommand" ? [{ Key: "audio/master", UploadId: "stale", Initiated: new Date(0 + 1) }] : [] };
  };
  try {
    await multipart.createMultipartUpload("audio/master", "audio/flac", privateOptions);
    const url = new URL(await multipart.getMultipartPartUploadUrl("audio/master", "upload", 1, 60, privateOptions));
    assert.ok(url.hostname.startsWith("private-test.") || url.pathname.startsWith("/private-test/"));
    await multipart.completeMultipartUpload("audio/master", "upload", [{ partNumber: 1, etag: "etag" }], privateOptions);
    await multipart.cleanupStaleMultipartUploads("audio/", 1000, privateOptions);
    assert.equal(commands.length, 4);
    assert.ok(commands.every((command) => command.Bucket === "private-test"));
  } finally { r2.r2Client.send = send; }
});
