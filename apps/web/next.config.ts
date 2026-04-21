import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled trailingSlash to avoid 308 redirects on API requests during development
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3001/api/:path*", // Default backend port
      },
    ];
  },
};

export default nextConfig;
