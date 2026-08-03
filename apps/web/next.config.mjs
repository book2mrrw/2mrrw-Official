import { withSentryConfig } from "@sentry/nextjs";

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
    value: "camera=(), microphone=(), geolocation=(), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  images: {
    remotePatterns,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
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
