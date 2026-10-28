import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Playwright server build into its own folder without clobbering a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Only /embed/* may be framed by other sites (it does its own allowlist check).
        // Everything else — admin, checkout, storefront — refuses to be framed elsewhere.
        source: "/:path((?!embed/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
