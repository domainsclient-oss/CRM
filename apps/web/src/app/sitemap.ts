import type { MetadataRoute } from "next";
import { DOCS } from "@crm/shared/content/docs";
import { PAGES } from "@crm/shared/content/marketing";
import { absolute } from "@/features/marketing/seo";

// Marketing host only; excludes noindex pages (07 §2). lastmod comes from the content.
const NOINDEX = new Set<string>([PAGES.findWorkspace.path]);

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = Object.values(PAGES)
    .filter((p) => !NOINDEX.has(p.path))
    .map((p) => ({
      url: absolute(p.path),
      lastModified: p.updated,
      priority: p.path === "/" ? 1 : p.path.startsWith("/legal/") ? 0.3 : 0.7,
    }));
  const docs = DOCS.map((d) => ({
    url: absolute(`/docs/${d.slug}`),
    lastModified: d.updated,
    priority: 0.6,
  }));
  return [...pages, ...docs];
}
