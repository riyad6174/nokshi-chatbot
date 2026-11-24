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
    // Keep pages you just visited in the browser for 30 s, so going back and forth between admin
    // pages is instant instead of re-loading everything from the database. Any save (server action
    // with revalidatePath) clears this cache, so edits always show up straight away.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
