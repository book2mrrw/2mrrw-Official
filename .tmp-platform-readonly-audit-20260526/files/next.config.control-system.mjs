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

const nextConfig = {
  distDir: ".next",
  experimental: {},
  images: {
    remotePatterns,
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "https://www.2mrrw.com",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, x-control-session-id",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
