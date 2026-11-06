import { t } from "@crm/shared/i18n";

// Accessible chart: the data table IS the content (FR-RPT-001 AC: accessible table equivalents);
// bars are a decorative visual next to each row (aria-hidden).

export function BarTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<{ key: string; cells: Array<string | number>; bar: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.bar));
  return (
    <div
      className="overflow-x-auto"
      role="region"
      tabIndex={0}
      aria-label={t("list.records", { entity: caption })}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="py-1 pe-3 font-medium">
                {c}
              </th>
            ))}
            <th scope="col" className="w-1/3">
              <span className="sr-only">—</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="py-1 pe-3 text-left font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="py-1 pe-3 tabular-nums">
                    {c}
                  </td>
                ),
              )}
              <td aria-hidden className="py-1">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.round((r.bar / max) * 100)}%` }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
