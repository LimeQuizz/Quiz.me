import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      // Largest legitimate payload: 500 cards x 2 x 2000 chars.
      bodySizeLimit: "3mb",
    },
    // The middleware sees request bodies up to this size; /api/uploads is
    // excluded from the middleware and streams instead.
    middlewareClientMaxBodySize: "3mb",
  },
  async headers() {
    // Applied to everything, including static assets the middleware skips.
    return [
      {
        source: "/:path*",
        headers: Object.entries(STATIC_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
    ];
  },
};

export default nextConfig;
