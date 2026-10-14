import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["playwright-core", "mongodb"],
  // Playwright's bundled runtime loads browsers.json through a computed path,
  // which automatic tracing misses on Vercel. Include its remote-CDP runtime.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/playwright-core/browsers.json", "./node_modules/playwright-core/package.json", "./node_modules/playwright-core/lib/**/*"],
  },
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default config;
