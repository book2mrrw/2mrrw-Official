import { withSentryConfig } from "@sentry/nextjs";
// Relative path, not the "@/" alias — next.config runs in plain Node at build
// time, where the alias does not exist. The manifest is dependency-free so it
// can be imported from here, from Edge middleware, and from tests alike.
import { staticAssetCacheHeaders } from "./src/lib/static-asset-manifest.js";

/** @type {import('next').NextConfig} */
const r2PublicHost = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

const remotePatterns = [
  {
    protocol: "https",
    hostname: "pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev",
  },
  {
    protocol: "https",
    hostname: "**.r2.dev",
  },
  {
    protocol: "https",
    hostname: "**.r2.cloudflarestorage.com",
  },
];

if (r2PublicHost) {
  remotePatterns.push({
    protocol: "https",
    hostname: r2PublicHost,
  });
}

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  // Deployment-skew protection. Vercel injects VERCEL_DEPLOYMENT_ID when Skew
  // Protection is enabled on the project; Next then stamps asset URLs and sends
  // `x-deployment-id` on RSC fetches so a client still running the previous
  // bundle is routed back to ITS OWN deployment instead of 404-ing a chunk that
  // no longer exists. That is what makes a deploy-during-session survivable
  // without a page reload -- the usual `location.reload()` on ChunkLoadError is
  // not used anywhere in this app by design.
  // Declared here rather than left implicit so the dependency is visible in the
  // repo and not only in a dashboard checkbox.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  images: {
    remotePatterns,
    // Negotiated against the request's Accept header, best first. Cover art is
    // photographic, where AVIF is materially smaller than WebP at equal quality.
    formats: ["image/avif", "image/webp"],
    // Floor for the Cache-Control the optimizer sets on a derivative. Without
    // it the optimizer inherits the upstream header, and public/ files are
    // served `max-age=0, must-revalidate` — re-validating every cover on every
    // page load, the exact cost this work exists to remove.
    //
    // Deliberately one day, not one year. A derivative is keyed by
    // (source URL, width, quality, format), and cover URLs carry no revision
    // yet — so replacing the bytes at /images/albums/ad.JPG in place would keep
    // serving the old derivative for the whole TTL. One day bounds that to
    // something a redeploy comfortably outlives. Raise this to 31536000 only
    // once the cover URL carries artwork_revision and is genuinely immutable.
    minimumCacheTTL: 86400,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Cache policy for every static asset prefix, derived from the shared
      // manifest rather than listed here. /environment/ keeps its immutable
      // rule; /images/, /videos/, /audio/ and /icons/ gain bounded TTLs they
      // previously had none of. Unhashed paths are deliberately never
      // immutable -- see the manifest for why.
      ...staticAssetCacheHeaders(),
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "2mrrw.com" }],
        destination: "https://www.2mrrw.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
