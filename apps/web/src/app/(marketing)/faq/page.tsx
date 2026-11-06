import { FAQ } from "@crm/shared/content/docs";
import { PAGES } from "@crm/shared/content/marketing";
import { faqPage } from "@crm/shared/seo";
import { JsonLdScript, LastUpdated, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.faq);

// FAQPage markup mirrors the visible questions and answers verbatim (07 §3).
export default function FaqPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6">
      <JsonLdScript data={faqPage(FAQ)} />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Frequently asked questions</h1>
        <LastUpdated date={PAGES.faq.updated} />
      </header>
      {FAQ.map(([q, a]) => (
        <section key={q} aria-label={q}>
          <h2 className="mb-1 text-xl font-semibold">{q}</h2>
          <p>{a}</p>
        </section>
      ))}
    </article>
  );
}
