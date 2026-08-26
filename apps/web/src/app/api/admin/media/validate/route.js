/**
 * POST /api/admin/media/validate
 *
 * Admin-only visual-asset pre-publication validator.
 * Accepts an R2 object key, fetches the first 64 KB, and runs:
 *
 *   1. Object presence + metadata (HEAD)
 *   2. Magic-byte container detection (MP4, WebM, JPEG, PNG, WebP)
 *   3. Fast-start (moov-before-mdat) heuristic for MP4 — critical for streaming
 *   4. Content-Type header match against detected container
 *   5. File-size sanity range (512 B → 2 GB for video; 1 KB → 30 MB for image)
 *
 * Does NOT transcode, resize, or decode frames — validation is always synchronous
 * with a bounded byte budget. Called by ingest pipelines, never on user requests.
 *
 * Body: { r2Key: string }
 * Response: { valid: boolean, detected: {...}, checks: {...}, errors: string[], warnings: string[] }
 */

import { NextResponse } from "next/server";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";

const SCAN_BYTES = 65_536; // 64 KB — enough to find moov atom in fast-start MP4

// ── Magic byte signatures ─────────────────────────────────────────────────────

function detectContainer(buf) {
  if (buf.length < 8) return "unknown";

  // WebM: EBML magic 0x1A 0x45 0xDF 0xA3 at byte 0
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";

  // JPEG: 0xFF 0xD8 at byte 0
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";

  // PNG: 8-byte signature at byte 0
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "png";

  // WebP: RIFF at 0–3, WEBP at 8–11
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "webp";

  // MP4 / QuickTime: bytes 4–7 = 'ftyp' OR 'moov' (some encoders write moov first)
  if (buf.length >= 8) {
    const box4 = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    if (box4 === "ftyp" || box4 === "moov" || box4 === "free" || box4 === "wide" || box4 === "mdat") return "mp4";
  }

  return "unknown";
}

// ── MP4 fast-start: moov-before-mdat scan ────────────────────────────────────

function isMp4FastStart(buf) {
  let offset = 0;
  let moovOffset = -1;
  let mdatOffset = -1;

  while (offset + 8 <= buf.length) {
    // Each MP4 box: 4-byte big-endian size, 4-byte type string
    const size =
      (buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3];
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);

    if (type === "moov" && moovOffset === -1) moovOffset = offset;
    if (type === "mdat" && mdatOffset === -1) mdatOffset = offset;
    if (moovOffset !== -1 && mdatOffset !== -1) break;

    // size 0 = extends to EOF; size 1 = 64-bit extended size (too large for 64 KB scan)
    if (size === 0 || size === 1 || size < 8) break;
    offset += size;
  }

  if (moovOffset === -1 && mdatOffset === -1) return null; // could not determine
  if (mdatOffset === -1) return true;  // only moov found in window → fast-start
  if (moovOffset === -1) return false; // only mdat found → mdat-first (NOT fast-start)
  return moovOffset < mdatOffset;
}

// ── File size ranges (bytes) ──────────────────────────────────────────────────

const SIZE_RANGES = {
  video: { min: 512, max: 2 * 1024 * 1024 * 1024 }, // 512 B – 2 GB
  image: { min: 1024, max: 30 * 1024 * 1024 },        // 1 KB – 30 MB
};

const CONTAINER_CATEGORY = {
  mp4: "video",
  webm: "video",
  jpeg: "image",
  png: "image",
  webp: "image",
  unknown: "unknown",
};

// Expected Content-Type prefixes per container
const CONTAINER_MIME = {
  mp4: ["video/mp4", "video/quicktime", "application/octet-stream"],
  webm: ["video/webm", "application/octet-stream"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function requireAdmin() {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) return null;
  return user;
}

async function readRangeBuffer(key) {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Range: `bytes=0-${SCAN_BYTES - 1}`,
  });
  const res = await r2Client.send(cmd);
  const chunks = [];
  for await (const chunk of res.Body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return { buf: Buffer.concat(chunks), contentType: res.ContentType || null };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const user = await requireAdmin();
  if (!user) return json({ error: "Forbidden" }, 403);

  if (!R2_BUCKET) return json({ error: "R2 not configured" }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const r2Key = String(body.r2Key || "").replace(/^\//, "").trim();
  if (!r2Key) return json({ error: "r2Key required" }, 400);

  const errors = [];
  const warnings = [];

  // ── Step 1: HEAD — existence + declared size ──────────────────────────────
  let fileSize = null;
  let headContentType = null;
  try {
    const head = await r2Client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: r2Key })
    );
    fileSize = head.ContentLength ?? null;
    headContentType = head.ContentType || null;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") {
      return json({ error: "Object not found", r2Key }, 404);
    }
    return json({ error: "R2 HEAD failed", detail: err?.message }, 502);
  }

  // ── Step 2: Fetch first 64 KB ─────────────────────────────────────────────
  let buf = null;
  let getContentType = null;
  try {
    const result = await readRangeBuffer(r2Key);
    buf = result.buf;
    getContentType = result.contentType;
  } catch (err) {
    errors.push(`Failed to fetch object bytes: ${err?.message}`);
  }

  const effectiveContentType = getContentType || headContentType;

  // ── Step 3: Magic byte detection ──────────────────────────────────────────
  const container = buf ? detectContainer(buf) : "unknown";
  const category = CONTAINER_CATEGORY[container] || "unknown";

  const magicBytesCheck = container === "unknown" ? "fail" : "pass";
  if (container === "unknown") errors.push("Unrecognized container — magic bytes do not match MP4, WebM, JPEG, PNG, or WebP");

  // ── Step 4: Fast-start (moov-before-mdat) — MP4 only ─────────────────────
  let fastStart = null;
  let fastStartCheck = "skip";
  if (container === "mp4" && buf) {
    fastStart = isMp4FastStart(buf);
    if (fastStart === null) {
      fastStartCheck = "skip";
      warnings.push("Could not determine moov/mdat order in first 64 KB — ensure the file is properly containerized");
    } else if (fastStart) {
      fastStartCheck = "pass";
    } else {
      fastStartCheck = "fail";
      errors.push("MP4 is NOT fast-start: mdat appears before moov. Re-encode with -movflags +faststart for streaming compatibility");
    }
  }

  // ── Step 5: Content-Type match ────────────────────────────────────────────
  let contentTypeCheck = "skip";
  if (effectiveContentType && container !== "unknown") {
    const expected = CONTAINER_MIME[container] || [];
    const normalized = effectiveContentType.split(";")[0].trim().toLowerCase();
    if (expected.includes(normalized)) {
      contentTypeCheck = "pass";
    } else if (normalized === "application/octet-stream") {
      contentTypeCheck = "warn";
      warnings.push(`Content-Type is generic application/octet-stream — update to ${expected[0]} for correct CDN behavior`);
    } else {
      contentTypeCheck = "fail";
      errors.push(`Content-Type mismatch: declared "${effectiveContentType}", expected ${expected[0]} for ${container.toUpperCase()} container`);
    }
  }

  // ── Step 6: File size range ───────────────────────────────────────────────
  let fileSizeCheck = "skip";
  if (fileSize !== null && category !== "unknown") {
    const range = SIZE_RANGES[category];
    if (fileSize < range.min) {
      fileSizeCheck = "fail";
      errors.push(`File is suspiciously small (${fileSize} bytes < ${range.min} byte minimum for ${category})`);
    } else if (fileSize > range.max) {
      fileSizeCheck = "fail";
      errors.push(`File exceeds maximum size for ${category} (${Math.round(fileSize / 1024 / 1024)} MB > ${range.max / 1024 / 1024} MB)`);
    } else {
      fileSizeCheck = "pass";
    }
  }

  const valid = errors.length === 0;

  return json({
    r2Key,
    valid,
    detected: {
      container,
      category,
      fastStart,
      fileSize,
      contentType: effectiveContentType,
    },
    checks: {
      magicBytes: magicBytesCheck,
      fastStart: fastStartCheck,
      contentType: contentTypeCheck,
      fileSize: fileSizeCheck,
    },
    errors,
    warnings,
  });
}
