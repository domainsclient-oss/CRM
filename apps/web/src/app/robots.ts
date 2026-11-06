import type { MetadataRoute } from "next";
import { absolute } from "@/features/marketing/seo";

// Marketing host only (07 §1). Workspace and console hosts get their policy from the proxy,
// which answers /robots.txt before this route is reached.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/find-workspace", "/api/"] },
    sitemap: absolute("/sitemap.xml"),
  };
}
