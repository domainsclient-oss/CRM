import { FINDER_FORM, PAGES } from "@crm/shared/content/marketing";
import { pageMetadata } from "@/features/marketing/seo";
import { FinderForm } from "@/features/marketing/finder-form";

// Not indexed (07 §1): a utility page, excluded from the sitemap.
export const metadata = pageMetadata(PAGES.findWorkspace, { index: false });

export default function FindWorkspacePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold">{FINDER_FORM.heading}</h1>
        <p className="text-lg text-muted-foreground">{FINDER_FORM.intro}</p>
      </header>
      <FinderForm />
    </div>
  );
}
