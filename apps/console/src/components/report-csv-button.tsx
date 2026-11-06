"use client";

import { Button } from "@crm/ui/components/button";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t } from "@crm/shared/i18n";

/** Downloads the agency usage report CSV (formula-protected by the shared serializer). */
export function ReportCsvButton({
  action,
}: {
  action: (input: unknown) => Promise<ActionResult<unknown>>;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      onClick={async () => {
        const result = await action({});
        if (!result.ok) return void toast.error(actionErrorMessage(result.error));
        const url = URL.createObjectURL(
          new Blob([(result.data as { csv: string }).csv], { type: "text/csv;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "usage-report.csv";
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      {t("console.report.export")}
    </Button>
  );
}
