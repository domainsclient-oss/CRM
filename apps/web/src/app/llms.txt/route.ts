import { DOCS } from "@crm/shared/content/docs";
import { HOME, PAGES, PRODUCT } from "@crm/shared/content/marketing";
import { absolute } from "@/features/marketing/seo";

// /llms.txt (07 §5, AEO): a plain-text map of the public site for answer engines. Marketing
// host only — the proxy 404s it everywhere else. Static: built from the content modules.
export const dynamic = "force-static";

export function GET() {
  const link = (title: string, path: string, note?: string) =>
    `- [${title}](${absolute(path)})${note ? `: ${note}` : ""}`;
  const body = [
    `# ${PRODUCT}`,
    "",
    `> ${HOME.lead}`,
    "",
    "## Product",
    ...["features", "agencies", "plans", "security", "about", "contact"].map((k) => {
      const p = PAGES[k as keyof typeof PAGES];
      return link(p.title, p.path, p.description);
    }),
    "",
    "## Help centre",
    ...DOCS.map((d) => link(d.title, `/docs/${d.slug}`, d.summary)),
    link(PAGES.faq.title, PAGES.faq.path),
    link(PAGES.glossary.title, PAGES.glossary.path),
    "",
    "## Legal",
    ...(["privacy", "terms", "cookies"] as const).map((k) => link(PAGES[k].title, PAGES[k].path)),
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
