"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";
import { auditExportAction } from "./actions";
import { download } from "./csv-button";

type Filter = {
  action: string | null;
  actorUid: string | null;
  from: string | null;
  to: string | null;
};

/** Filter by ONE of action or user, plus dates (FR-AUD-002 allowlisted combinations). */
export function AuditFilters({
  actions,
  members,
  current,
}: {
  actions: string[];
  members: Record<string, string>;
  current: Filter;
}) {
  const router = useRouter();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const q = new URLSearchParams();
    const by = String(d.get("by") ?? "");
    if (by.startsWith("action:")) q.set("action", by.slice(7));
    if (by.startsWith("actor:")) q.set("actor", by.slice(6));
    for (const k of ["from", "to"]) if (d.get(k)) q.set(k, String(d.get(k)));
    router.push(`/settings/audit${q.size ? `?${q}` : ""}`);
  }
  const value = current.action
    ? `action:${current.action}`
    : current.actorUid
      ? `actor:${current.actorUid}`
      : "";
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:flex-wrap sm:items-end"
      aria-describedby="audit-hint"
    >
      <div className="flex min-w-56 flex-col gap-1.5">
        <Label htmlFor="audit-by">
          {t("audit.action")} / {t("audit.actor")}
        </Label>
        <NativeSelect id="audit-by" name="by" defaultValue={value}>
          <option value="">{t("audit.anyAction")}</option>
          <optgroup label={t("audit.action")}>
            {actions.map((a) => (
              <option key={a} value={`action:${a}`}>
                {a}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("audit.actor")}>
            {Object.entries(members).map(([uid, name]) => (
              <option key={uid} value={`actor:${uid}`}>
                {name}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-from">{t("audit.from")}</Label>
        <Input id="audit-from" name="from" type="date" defaultValue={current.from ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-to">{t("audit.to")}</Label>
        <Input id="audit-to" name="to" type="date" defaultValue={current.to ?? ""} />
      </div>
      <Button type="submit">{t("list.apply")}</Button>
      <p id="audit-hint" className="w-full text-xs text-muted-foreground">
        {t("audit.filterHint")}
      </p>
    </form>
  );
}

export function AuditExportButton({ filter }: { filter: Filter }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      onClick={async () => {
        const result = await auditExportAction(filter);
        if (!result.ok) return void toast.error(actionErrorMessage(result.error));
        download("audit-log.csv", (result.data as { csv: string }).csv);
      }}
    >
      {t("audit.export")}
    </Button>
  );
}
