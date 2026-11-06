import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LEGAL, LEGAL_NOTICE } from "@crm/shared/content/docs";
import { PAGES } from "@crm/shared/content/marketing";
import { LastUpdated, pageMetadata } from "@/features/marketing/seo";

export const dynamicParams = false;

const DOCS = ["privacy", "terms", "cookies"] as const;
type LegalDoc = (typeof DOCS)[number];
const TITLES: Record<LegalDoc, string> = {
  privacy: "Privacy policy",
  terms: "Terms of service",
  cookies: "Cookie policy",
};

export function generateStaticParams() {
  return DOCS.map((doc) => ({ doc }));
}

const isDoc = (d: string): d is LegalDoc => (DOCS as readonly string[]).includes(d);

export async function generateMetadata(props: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await props.params;
  return isDoc(doc) ? pageMetadata(PAGES[doc]) : {};
}

export default async function LegalPage(props: PageProps<"/legal/[doc]">) {
  const { doc } = await props.params;
  if (!isDoc(doc)) notFound();
  return (
    <article className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-3xl font-semibold">{TITLES[doc]}</h1>
      <LastUpdated date={PAGES[doc].updated} />
      <p role="note" className="rounded-lg border border-amber-500/50 p-3 text-sm">
        {LEGAL_NOTICE}
      </p>
      {LEGAL[doc].map(([heading, body]) => (
        <section key={heading} aria-label={heading}>
          <h2 className="mb-1 text-xl font-semibold">{heading}</h2>
          <p>{body}</p>
        </section>
      ))}
    </article>
  );
}
