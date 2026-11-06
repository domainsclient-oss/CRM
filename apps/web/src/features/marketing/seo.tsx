import type { Metadata } from "next";
import { PRODUCT, type PageMeta } from "@crm/shared/content/marketing";
import { serializeJsonLd, type JsonLd } from "@crm/shared/seo";

// Marketing-host SEO helpers (07 §2–3). Canonicals are absolute on the configured marketing
// origin; JSON-LD can only be produced for the marketing host (the shared serializer throws
// otherwise).

export function siteOrigin(): string {
  const host = process.env.APP_MARKETING_HOST ?? "localhost:3000";
  const local = host.startsWith("localhost") || host.includes(".localhost");
  return `${local ? "http" : "https"}://${host}`;
}

export const absolute = (path: string) => `${siteOrigin()}${path === "/" ? "" : path}`;

export function pageMetadata(meta: PageMeta, opts: { index?: boolean } = {}): Metadata {
  const url = absolute(meta.path);
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: url },
    robots: opts.index === false ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: PRODUCT,
      title: meta.title,
      description: meta.description,
      url,
      images: [{ url: absolute("/og-image"), width: 1200, height: 630, alt: PRODUCT }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description },
  };
}

/** `<script type="application/ld+json">` — React emits script text verbatim; input is escaped. */
export function JsonLdScript({ data }: { data: JsonLd | JsonLd[] }) {
  return <script type="application/ld+json">{serializeJsonLd("marketing", data)}</script>;
}

export function LastUpdated({ date }: { date: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Last updated{" "}
      <time dateTime={date}>
        {new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
          dateStyle: "long",
          timeZone: "UTC",
        })}
      </time>
    </p>
  );
}
