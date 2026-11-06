import Link from "next/link";
import { FEATURES, PAGES, PRODUCT } from "@crm/shared/content/marketing";
import { softwareApplication } from "@crm/shared/seo";
import { JsonLdScript, LastUpdated, absolute, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.features);

export default function FeaturesPage() {
  return (
    <article className="flex flex-col gap-8">
      <JsonLdScript
        data={softwareApplication(PRODUCT, absolute("/features"), PAGES.features.description)}
      />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Features</h1>
        <p className="max-w-3xl text-lg text-muted-foreground">{PAGES.features.description}</p>
        <LastUpdated date={PAGES.features.updated} />
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        {FEATURES.map((f) => (
          <section key={f.title} aria-labelledby={`f-${f.title}`} className="rounded-xl border p-5">
            <h2 id={`f-${f.title}`} className="mb-2 text-xl font-semibold">
              {f.title}
            </h2>
            <p className="mb-3 text-muted-foreground">{f.body}</p>
            <ul className="list-disc ps-5">
              {f.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p>
        Questions? Read the{" "}
        <Link href="/docs" className="underline">
          help centre
        </Link>{" "}
        or{" "}
        <Link href="/contact" className="underline">
          request a demo
        </Link>
        .
      </p>
    </article>
  );
}
