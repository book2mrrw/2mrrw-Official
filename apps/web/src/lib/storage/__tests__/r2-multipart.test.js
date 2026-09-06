import assert from "node:assert/strict";
import test from "node:test";

// R2_BUCKET is read from process.env once, at r2.js's module-load time — set
// it before dynamically importing anything that transitively loads r2.js, so
// these tests exercise real request-building logic instead of tripping the
// "R2 not configured" guard on every call.
process.env.CLOUDFLARE_R2_BUCKET_NAME ||= "test-bucket";
process.env.CLOUDFLARE_R2_ENDPOINT ||= "https://r2.test";
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||= "test-access-key-id";
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||= "test-secret-access-key";

const { r2Client } = await import("@/lib/storage/r2");
const {
  createMultipartUpload,
  getMultipartPartUploadUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  listStaleMultipartUploads,
  cleanupStaleMultipartUploads,
} = await import("@/lib/storage/r2-multipart");

// Fake r2Client.send — records every command it receives and returns a
// canned response keyed by command constructor name, so these tests never
// make a real network call.
function withFakeSend(responses, fn) {
  const original = r2Client.send;
  const calls = [];
  r2Client.send = async (command) => {
    calls.push(command);
    const name = command.constructor.name;
    if (name in responses) {
      const res = responses[name];
      if (res instanceof Error) throw res;
      return typeof res === "function" ? res(command) : res;
    }
    throw new Error(`withFakeSend: no canned response for ${name}`);
  };
  return fn(calls).finally(() => {
    r2Client.send = original;
  });
}

test("createMultipartUpload returns the uploadId and normalized key", async () => {
  await withFakeSend(
    { CreateMultipartUploadCommand: { UploadId: "upload-123" } },
    async (calls) => {
      const result = await createMultipartUpload("/media/video/masters/abc/master.mov", "video/quicktime");
      assert.deepEqual(result, { uploadId: "upload-123", key: "media/video/masters/abc/master.mov" });
      assert.equal(calls[0].input.ContentType, "video/quicktime");
    }
  );
});

test("createMultipartUpload rejects a missing key", async () => {
  await assert.rejects(() => createMultipartUpload("", "video/mp4"), /missing bucket or key/);
});

test("getMultipartPartUploadUrl rejects an out-of-range part number before ever signing", async () => {
  await assert.rejects(() => getMultipartPartUploadUrl("k", "up-1", 0), /partNumber must be an integer between 1 and 10000/);
  await assert.rejects(() => getMultipartPartUploadUrl("k", "up-1", 10001), /partNumber must be an integer between 1 and 10000/);
  await assert.rejects(() => getMultipartPartUploadUrl("k", "up-1", 1.5), /partNumber must be an integer between 1 and 10000/);
});

test("getMultipartPartUploadUrl rejects a missing uploadId", async () => {
  await assert.rejects(() => getMultipartPartUploadUrl("k", null, 1), /missing bucket, key, or uploadId/);
});

test("completeMultipartUpload sorts parts by partNumber and maps to the S3 {PartNumber, ETag} shape", async () => {
  await withFakeSend(
    {
      CompleteMultipartUploadCommand: (command) => {
        assert.deepEqual(command.input.MultipartUpload.Parts, [
          { PartNumber: 1, ETag: '"etag-a"' },
          { PartNumber: 2, ETag: '"etag-b"' },
          { PartNumber: 3, ETag: '"etag-c"' },
        ]);
        return { ETag: '"final-etag"', Location: "https://example/master.mov" };
      },
    },
    async () => {
      const result = await completeMultipartUpload("key", "upload-1", [
        { partNumber: 3, etag: '"etag-c"' },
        { partNumber: 1, etag: '"etag-a"' },
        { partNumber: 2, etag: '"etag-b"' },
      ]);
      assert.deepEqual(result, { key: "key", etag: '"final-etag"', location: "https://example/master.mov" });
    }
  );
});

test("completeMultipartUpload rejects an empty parts array", async () => {
  await assert.rejects(() => completeMultipartUpload("key", "upload-1", []), /parts must be a non-empty array/);
});

test("abortMultipartUpload swallows a 404/NoSuchUpload — already gone is not an error", async () => {
  const notFound = Object.assign(new Error("no such upload"), { name: "NoSuchUpload" });
  await withFakeSend({ AbortMultipartUploadCommand: notFound }, async () => {
    await assert.doesNotReject(() => abortMultipartUpload("key", "upload-1"));
  });
});

test("abortMultipartUpload re-throws a real server error, not just 404s", async () => {
  const serverError = Object.assign(new Error("r2 down"), { $metadata: { httpStatusCode: 500 } });
  await withFakeSend({ AbortMultipartUploadCommand: serverError }, async () => {
    await assert.rejects(() => abortMultipartUpload("key", "upload-1"), /r2 down/);
  });
});

test("listStaleMultipartUploads filters by the cutoff and paginates via KeyMarker/UploadIdMarker", async () => {
  const now = Date.now();
  const old = new Date(now - 10 * 60 * 60 * 1000).toISOString(); // 10h ago
  const recent = new Date(now - 60 * 1000).toISOString(); // 1 min ago

  let call = 0;
  await withFakeSend(
    {
      ListMultipartUploadsCommand: () => {
        call += 1;
        if (call === 1) {
          return {
            Uploads: [{ Key: "stale-1", UploadId: "u1", Initiated: old }],
            IsTruncated: true,
            NextKeyMarker: "stale-1",
            NextUploadIdMarker: "u1",
          };
        }
        return {
          Uploads: [{ Key: "fresh-1", UploadId: "u2", Initiated: recent }],
          IsTruncated: false,
        };
      },
    },
    async () => {
      const stale = await listStaleMultipartUploads("media/video/masters/", 60 * 60 * 1000); // 1h threshold
      assert.equal(stale.length, 1);
      assert.equal(stale[0].key, "stale-1");
      assert.equal(call, 2, "must follow pagination markers to the second page");
    }
  );
});

test("cleanupStaleMultipartUploads aborts every stale upload it finds and returns the cleaned-up list", async () => {
  const old = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
  const aborted = [];
  await withFakeSend(
    {
      ListMultipartUploadsCommand: {
        Uploads: [{ Key: "stale-1", UploadId: "u1", Initiated: old }],
        IsTruncated: false,
      },
      AbortMultipartUploadCommand: (command) => {
        aborted.push(command.input.Key);
        return {};
      },
    },
    async () => {
      const result = await cleanupStaleMultipartUploads("media/video/masters/", 60 * 60 * 1000);
      assert.deepEqual(aborted, ["stale-1"]);
      assert.equal(result.length, 1);
    }
  );
});
