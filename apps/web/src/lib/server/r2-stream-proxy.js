import { applyMediaCors } from "@/lib/server/media-cors";

/**
 * Proxy a presigned R2 GET through Next.js. Used for HEAD requests and as fallback
 * when DIRECT_STREAM_REDIRECT_ENABLED is off. Direct redirect path (302 → R2) is
 * preferred for GET — see library/stream/route.js.
 * @param {Request} req
 * @param {string} signedUrl
 * @param {{ timing?: ReturnType<import("@/lib/server/server-timing").createServerTiming> }} [options]
 */
export async function proxySignedR2Get(req, signedUrl, { timing } = {}) {
  const rangeHeader = req.headers.get("range") || req.headers.get("Range");
  const fetchHeaders = rangeHeader ? { Range: rangeHeader } : {};
  const method = req.method === "HEAD" ? "HEAD" : "GET";

  let r2Response;
  try {
    r2Response = await fetch(signedUrl, {
      method,
      headers: fetchHeaders,
      // Propagate client disconnect so we don't hold an open R2 socket after seek/skip.
      signal: req.signal ?? undefined,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("[r2-stream-proxy] upstream fetch failed", { message: err?.message });
    return applyMediaCors(
      req,
      new Response(JSON.stringify({ error: "Stream unavailable", code: "UPSTREAM_ERROR" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
  timing?.mark("cdn");

  const headers = {
    "Content-Type": r2Response.headers.get("Content-Type") ?? "audio/mpeg",
    "Accept-Ranges": r2Response.headers.get("Accept-Ranges") ?? "bytes",
    "Cache-Control": "private, max-age=3300",
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
