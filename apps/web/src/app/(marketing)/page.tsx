import Link from "next/link";
import { HOME, PAGES, PRODUCT } from "@crm/shared/content/marketing";
import { organization, softwareApplication, website } from "@crm/shared/seo";
import { JsonLdScript, absolute, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.home);

export default function Home() {
  return (
    <div className="flex flex-col gap-12">
      <JsonLdScript
        data={[
          organization(PRODUCT, absolute("/")),
          website(PRODUCT, absolute("/")),
          softwareApplication(PRODUCT, absolute("/"), PAGES.home.description),
        ]}
      />
      <section className="flex max-w-3xl flex-col gap-4 py-8">
        <h1 className="text-4xl font-semibold tracking-tight">{HOME.heading}</h1>
        <p className="text-lg text-muted-foreground">{HOME.lead}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/contact"
            className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground"
          >
            {HOME.cta}
          </Link>
          <Link
            href="/features"
            className="inline-flex min-h-10 items-center rounded-md border px-4"
          >
            {HOME.secondary}
          </Link>
        </div>
      </section>
      <section aria-labelledby="why" className="grid gap-6 md:grid-cols-3">
        <h2 id="why" className="sr-only">
          Why {PRODUCT}
        </h2>
        {HOME.points.map((p) => (
          <div key={p.title} className="rounded-xl border p-5">
            <h3 className="mb-2 font-semibold">{p.title}</h3>
            <p className="text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
