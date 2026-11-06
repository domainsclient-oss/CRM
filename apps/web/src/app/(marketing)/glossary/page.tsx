import { GLOSSARY } from "@crm/shared/content/docs";
import { PAGES } from "@crm/shared/content/marketing";
import { LastUpdated, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.glossary);

export default function GlossaryPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Glossary</h1>
        <LastUpdated date={PAGES.glossary.updated} />
      </header>
      <dl className="flex flex-col gap-4">
        {GLOSSARY.map(([term, def]) => (
          <div key={term}>
            <dt className="text-lg font-semibold">{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
