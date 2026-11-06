import type { HostClass } from "./hosts";

// SEO helpers (NFR-SEO-001/002, requirements/07). Structured data exists only on the marketing
// host: every builder takes the host class and throws for anything else (07 §5 "lint: JSON-LD
// helper throws if host class ≠ marketing").

export type JsonLd = Record<string, unknown>;

/** Serialize for a <script type="application/ld+json"> block, safe against `</script>` breakout. */
export function serializeJsonLd(hostClass: HostClass, data: JsonLd | JsonLd[]): string {
  if (hostClass !== "marketing") throw new Error(`JSON-LD is not allowed on ${hostClass} hosts`);
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

export const organization = (name: string, url: string): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name,
  url,
  logo: `${url}/icon.png`,
});

export const website = (name: string, url: string): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name,
  url,
});

/** No `offers`: prices are set by agencies, and 07 §3 allows only real, current prices. */
export const softwareApplication = (name: string, url: string, description: string): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name,
  url,
  description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
});

/** FAQPage — questions and answers must match the visible page verbatim. */
export const faqPage = (items: Array<[string, string]>): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map(([q, a]) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});

export const techArticle = (a: {
  headline: string;
  description: string;
  url: string;
  dateModified: string;
  publisher: string;
}): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: a.headline,
  description: a.description,
  url: a.url,
  dateModified: a.dateModified,
  publisher: { "@type": "Organization", name: a.publisher },
});

export const breadcrumbs = (items: Array<[name: string, url: string]>): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, item], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item,
  })),
});

/**
 * robots.txt per host class (07 §1). Workspace hosts allow crawling so crawlers can see the
 * `noindex` header on every response; consoles disallow everything; the marketing host is served
 * by the app's robots metadata route.
 */
export function robotsTxt(hostClass: Exclude<HostClass, "marketing">): string {
  if (hostClass === "workspace") return "User-agent: *\nAllow: /\nDisallow: /api/\n";
  return "User-agent: *\nDisallow: /\n";
}
