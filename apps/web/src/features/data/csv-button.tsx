"use client";

import { Button } from "@crm/ui/components/button";
import { toCsv } from "@crm/shared/csv";
import { t } from "@crm/shared/i18n";

/** Report CSV download (FR-RPT-002) with formula-injection protection (shared serializer). */
export function CsvButton({
  name,
  header,
  rows,
  label,
}: {
  name: string;
  header: string[];
  rows: Array<Array<string | number>>;
  label?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() => download(name, toCsv([header, ...rows]))}
    >
      {label ?? t("reports.export")}
    </Button>
  );
}

export function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
