import { ABOUT_PAGE, PAGES, PRODUCT } from "@crm/shared/content/marketing";
import { organization } from "@crm/shared/seo";
import { JsonLdScript, LastUpdated, absolute, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.about);

export default function AboutPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-4">
      <JsonLdScript data={organization(PRODUCT, absolute("/"))} />
      <h1 className="text-3xl font-semibold">{ABOUT_PAGE.heading}</h1>
      <LastUpdated date={PAGES.about.updated} />
      {ABOUT_PAGE.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </article>
  );
}
