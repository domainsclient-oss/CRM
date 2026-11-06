"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@crm/ui/components/button";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";
import type { ListEntity } from "@crm/shared/records/list-specs";
import { exportListAction } from "./actions";

/** List CSV export of the current (allowlisted) filter and sort as a job (FR-IMP-002). */
export function ExportListButton({
  entity,
  query,
}: {
  entity: ListEntity;
  query: { sort?: string; filter?: string; value?: string };
}) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const result = await exportListAction({ entity, ...query });
          setPending(false);
          if (!result.ok) return void toast.error(actionErrorMessage(result.error));
          setDone(true);
          toast.success(t("export.started"));
        }}
      >
        {t("export.list")}
      </Button>
      {done ? (
        <Link href="/settings/import" className="text-sm underline underline-offset-4">
          {t("import.jobs")}
        </Link>
      ) : null}
    </span>
  );
}
