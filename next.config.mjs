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
  images: {
    remotePatterns,
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

export default nextConfig;
