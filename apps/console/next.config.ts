import type { NextConfig } from "next";

// PROTECTED FILE (requirements/08 §8).
// cacheComponents / Partial Prerendering are intentionally OFF: authenticated routes use a
// per-request CSP nonce, and a prerendered static shell can't carry one (Next.js 16 CSP
// guide; requirements/04 §10). Routes that read cookies/headers render per request;
// marketing pages without runtime data are still statically generated.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Brand uploads (logos ≤ 1 MB) go through Server Actions; the image pipeline re-checks sizes.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
