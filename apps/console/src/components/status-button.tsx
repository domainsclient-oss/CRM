"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@crm/ui/components/button";
import type { ActionResult } from "@crm/shared/errors";
import { t } from "@crm/shared/i18n";
import { ActionError } from "./action-feedback";

/** Suspend / reactivate toggle for an agency or workspace row. */
export function StatusButton({
  label,
  status,
  action,
  idField,
  id,
}: {
  /** Accessible context, e.g. the row's name. */
  label: string;
  status: string;
  /** Server Action reference; called with { [idField]: id, status }. */
  action: (input: unknown) => Promise<ActionResult<unknown>>;
  idField: "tenantId" | "agencyId";
  id: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  if (status !== "active" && status !== "suspended") return null;
  const next = status === "active" ? "suspended" : "active";
  const text = next === "suspended" ? t("console.action.suspend") : t("console.action.reactivate");

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={next === "suspended" ? "destructive" : "outline"}
        disabled={pending}
        aria-label={`${text}: ${label}`}
        onClick={async () => {
          setPending(true);
          const r = await action({ [idField]: id, status: next });
          setResult(r);
          setPending(false);
          if (r.ok) router.refresh();
        }}
      >
        {text}
      </Button>
      <ActionError result={result} />
    </div>
  );
}
