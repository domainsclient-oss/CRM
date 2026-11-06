import { PAGES, PLANS_PAGE } from "@crm/shared/content/marketing";
import { LastUpdated, pageMetadata } from "@/features/marketing/seo";

export const metadata = pageMetadata(PAGES.plans);

// Entitlements only — prices are set per agency (OQ-25), so none are shown or marked up.
export default function PlansPage() {
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{PLANS_PAGE.heading}</h1>
        <p className="max-w-3xl text-lg text-muted-foreground">{PLANS_PAGE.lead}</p>
        <LastUpdated date={PAGES.plans.updated} />
      </header>
      <div
        className="overflow-x-auto rounded-xl border"
        role="region"
        tabIndex={0}
        aria-label="Plan comparison"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Plan comparison</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="px-3 py-2">
                Feature
              </th>
              {PLANS_PAGE.columns.map((c) => (
                <th key={c} scope="col" className="px-3 py-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLANS_PAGE.rows.map(([feature, ...values]) => (
              <tr key={feature} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {feature}
                </th>
                {values.map((v, i) => (
                  <td key={i} className="px-3 py-2">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">{PLANS_PAGE.footnote}</p>
    </article>
  );
}
