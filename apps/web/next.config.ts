import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Disabled trailingSlash to avoid 308 redirects on API requests during development
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://backend:3001/api/:path*", // Docker service name
      },
    ];
  },
};

export default nextConfig;
