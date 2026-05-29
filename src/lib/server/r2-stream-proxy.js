import { applyMediaCors } from "@/lib/server/media-cors";

/**
 * Proxy a presigned R2 GET through Next.js so the browser never hits
 * *.r2.cloudflarestorage.com (S3 endpoint ignores dashboard CORS).
 */
export async function proxySignedR2Get(req, signedUrl) {
  const rangeHeader = req.headers.get("range") || req.headers.get("Range");
  const fetchHeaders = rangeHeader ? { Range: rangeHeader } : {};
  const method = req.method === "HEAD" ? "HEAD" : "GET";

  const r2Response = await fetch(signedUrl, { method, headers: fetchHeaders });

  const headers = {
    "Content-Type": r2Response.headers.get("Content-Type") ?? "audio/mpeg",
    "Accept-Ranges": r2Response.headers.get("Accept-Ranges") ?? "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };

  const contentLength = r2Response.headers.get("Content-Length");
  const contentRange = r2Response.headers.get("Content-Range");
  if (contentLength) headers["Content-Length"] = contentLength;
  if (contentRange) headers["Content-Range"] = contentRange;

  const body = method === "HEAD" ? null : r2Response.body;
  return applyMediaCors(
    req,
    new Response(body, {
      status: r2Response.status,
      headers,
    })
  );
}
