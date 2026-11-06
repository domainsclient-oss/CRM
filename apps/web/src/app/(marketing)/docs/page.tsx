import { DOCS } from "@crm/shared/content/docs";
import { PAGES } from "@crm/shared/content/marketing";
import { LastUpdated, pageMetadata } from "@/features/marketing/seo";
import { DocsSearch } from "@/features/marketing/docs-search";

export const metadata = pageMetadata(PAGES.docs);

export default function DocsIndex() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Help centre</h1>
        <p className="text-lg text-muted-foreground">{PAGES.docs.description}</p>
        <LastUpdated date={PAGES.docs.updated} />
      </header>
      <DocsSearch
        articles={DOCS.map((d) => ({ slug: d.slug, title: d.title, summary: d.summary }))}
      />
    </div>
  );
}
