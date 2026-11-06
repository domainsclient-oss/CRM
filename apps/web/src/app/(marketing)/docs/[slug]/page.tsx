import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DOCS } from "@crm/shared/content/docs";
import { PRODUCT } from "@crm/shared/content/marketing";
import { breadcrumbs, techArticle } from "@crm/shared/seo";
import { JsonLdScript, LastUpdated, absolute, pageMetadata } from "@/features/marketing/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

const find = (slug: string) => DOCS.find((d) => d.slug === slug);

export async function generateMetadata(props: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const doc = find((await props.params).slug);
  if (!doc) return {};
  return pageMetadata({
    path: `/docs/${doc.slug}`,
    title: doc.title.length <= 60 ? doc.title : `${doc.title.slice(0, 57)}…`,
    description: doc.summary.length <= 155 ? doc.summary : `${doc.summary.slice(0, 152)}…`,
    updated: doc.updated,
  });
}

// Article template (07 §4): Summary · Steps · Limits · Troubleshooting · Related.
export default async function DocPage(props: PageProps<"/docs/[slug]">) {
  const doc = find((await props.params).slug);
  if (!doc) notFound();
  const url = absolute(`/docs/${doc.slug}`);
  return (
    <article className="flex max-w-3xl flex-col gap-6">
      <JsonLdScript
        data={[
          techArticle({
            headline: doc.title,
            description: doc.summary,
            url,
            dateModified: doc.updated,
            publisher: PRODUCT,
          }),
          breadcrumbs([
            ["Help centre", absolute("/docs")],
            [doc.title, url],
          ]),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/docs" className="underline">
          Help centre
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{doc.title}</h1>
        <LastUpdated date={doc.updated} />
      </header>
      <section aria-labelledby="summary">
        <h2 id="summary" className="mb-1 text-xl font-semibold">
          Summary
        </h2>
        <p>{doc.summary}</p>
      </section>
      <section aria-labelledby="steps">
        <h2 id="steps" className="mb-1 text-xl font-semibold">
          Steps
        </h2>
        <ol className="list-decimal ps-5">
          {doc.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="limits">
        <h2 id="limits" className="mb-1 text-xl font-semibold">
          Limits
        </h2>
        <ul className="list-disc ps-5">
          {doc.limits.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="troubleshooting">
        <h2 id="troubleshooting" className="mb-1 text-xl font-semibold">
          Troubleshooting
        </h2>
        <dl>
          {doc.troubleshooting.map(([problem, fix]) => (
            <div key={problem} className="mb-2">
              <dt className="font-medium">{problem}</dt>
              <dd>{fix}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="related">
        <h2 id="related" className="mb-1 text-xl font-semibold">
          Related
        </h2>
        <ul className="list-disc ps-5">
          {doc.related.map((slug) => (
            <li key={slug}>
              <Link href={`/docs/${slug}`} className="underline">
                {find(slug)?.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
