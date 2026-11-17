import { NextResponse } from "next/server";
import { PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { r2Client } from "@/lib/storage/r2";
import { requireAdminOrCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";

export const dynamic = "force-dynamic";

const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME;

/**
 * The bucket's one CORS policy. R2 serves it on both the S3-compatible
 * endpoint (*.r2.cloudflarestorage.com, signed URLs) and the public CDN
 * (pub-*.r2.dev: covers, previews, HLS segments) — the CDN answers with
 * exactly these origins, methods and expose headers. Without it,
 * crossOrigin="anonymous" audio elements and HLS segment fetches get
 * CORS-blocked by iOS Safari.
 */
const CORS_POLICY = {
  CORSRules: [
    {
      // Presigned PUT uploads from the browser go directly to R2 — PUT must be allowed
      AllowedOrigins: [
        "https://www.2mrrw.com",
        "https://2mrrw.com",
        "https://artist-platform-silk.vercel.app",
        "https://2mrrw-official.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        // 2MRRW iOS app: WKWebView serves the website interface as this origin
        // (the Android app already runs as https://www.2mrrw.com).
        "capacitor://www.2mrrw.com",
      ],
      AllowedMethods: ["GET", "HEAD", "PUT", "DELETE"],
      AllowedHeaders: ["*"],
      ExposeHeaders: [
        "Accept-Ranges",
        "Content-Length",
        "Content-Range",
        "Content-Type",
        "ETag",
        "Last-Modified",
      ],
      MaxAgeSeconds: 86400,
    },
  ],
};

export async function POST(req) {
  const actor = await requireAdminOrCapability(req, ServiceCapability.R2_CORS_CONFIGURE);
  if (!actor.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!R2_BUCKET) {
    return NextResponse.json({ error: "CLOUDFLARE_R2_BUCKET_NAME not set" }, { status: 500 });
  }

  try {
    await r2Client.send(
      new PutBucketCorsCommand({ Bucket: R2_BUCKET, CORSConfiguration: CORS_POLICY })
    );
    return NextResponse.json({ ok: true, bucket: R2_BUCKET, rules: CORS_POLICY.CORSRules.length });
  } catch (err) {
    console.error("[apply-r2-cors] PutBucketCors failed", { message: err?.message });
    return NextResponse.json({ error: err?.message || "PutBucketCors failed" }, { status: 500 });
  }
}

export async function GET(req) {
  const actor = await requireAdminOrCapability(req, ServiceCapability.R2_CORS_CONFIGURE);
  if (!actor.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!R2_BUCKET) {
    return NextResponse.json({ error: "CLOUDFLARE_R2_BUCKET_NAME not set" }, { status: 500 });
  }

  try {
    const result = await r2Client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
    return NextResponse.json({ ok: true, bucket: R2_BUCKET, rules: result.CORSRules ?? [] });
  } catch (err) {
    const noPolicy = err?.name === "NoSuchCORSConfiguration";
    if (noPolicy) return NextResponse.json({ ok: true, bucket: R2_BUCKET, rules: [] });
    console.error("[apply-r2-cors] GetBucketCors failed", { message: err?.message });
    return NextResponse.json({ error: err?.message || "GetBucketCors failed" }, { status: 500 });
  }
}
