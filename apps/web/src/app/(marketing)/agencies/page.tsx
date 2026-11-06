import Link from "next/link";
import { AGENCIES_PAGE, PAGES } from "@crm/shared/content/marketing";
import { LastUpdated, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.agencies);

export default function AgenciesPage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{AGENCIES_PAGE.heading}</h1>
        <p className="max-w-3xl text-lg text-muted-foreground">{AGENCIES_PAGE.lead}</p>
        <LastUpdated date={PAGES.agencies.updated} />
      </header>
      <section aria-labelledby="how">
        <h2 id="how" className="mb-4 text-xl font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 md:grid-cols-2">
          {AGENCIES_PAGE.steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border p-5">
              <h3 className="mb-1 font-semibold">
                {i + 1}. {s.title}
              </h3>
              <p className="text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <p className="rounded-lg border p-4">{AGENCIES_PAGE.note}</p>
      <p>
        <Link href="/contact" className="underline">
          Talk to us about becoming a partner
        </Link>
      </p>
    </article>
  );
}
