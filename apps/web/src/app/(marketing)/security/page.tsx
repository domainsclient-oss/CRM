import { PAGES, SECURITY_PAGE } from "@crm/shared/content/marketing";
import { LastUpdated, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.security);

export default function SecurityPage() {
  return (
    <article className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Security and privacy</h1>
        <p className="text-lg text-muted-foreground">{PAGES.security.description}</p>
        <LastUpdated date={PAGES.security.updated} />
      </header>
      {SECURITY_PAGE.map(({ question, answer }) => (
        <section key={question} aria-label={question}>
          <h2 className="mb-1 text-xl font-semibold">{question}</h2>
          <p>{answer}</p>
        </section>
      ))}
    </article>
  );
}
