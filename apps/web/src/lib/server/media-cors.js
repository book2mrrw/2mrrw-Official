/** Allowed browser origins for /api/media/* and /api/library/* (matches R2 bucket CORS). */
const MEDIA_CORS_ORIGINS = new Set([
  "https://www.2mrrw.com",
  "https://2mrrw.com",
  "https://artist-platform-silk.vercel.app",
  "https://2mrrw-official.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
// Dynamically include the current Vercel deployment URL (set per-deployment by Vercel).
if (process.env.VERCEL_URL) {
  MEDIA_CORS_ORIGINS.add(`https://${process.env.VERCEL_URL}`);
}

/**
 * CORS headers for /api/media/* and /api/library/* — Range required for seeking.
 * @param {Request} req
 * @returns {Record<string, string>}
 */
export function mediaCorsHeaders(req) {
  const origin = req.headers.get("origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers":
      "Range, Content-Type, Authorization, Origin, Accept",
    "Access-Control-Expose-Headers":
      "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified, Server-Timing, X-Playback-Timing",
  };
  if (origin && MEDIA_CORS_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

/** OPTIONS preflight for /api/media/* and /api/library/* routes. */
export function mediaCorsPreflightResponse(req) {
  return new Response(null, { status: 204, headers: mediaCorsHeaders(req) });
}

/** Merge media CORS headers into a NextResponse or plain Response init. */
export function applyMediaCors(req, response) {
  const cors = mediaCorsHeaders(req);
  for (const [key, value] of Object.entries(cors)) {
    response.headers.set(key, value);
  }
  return response;
}
