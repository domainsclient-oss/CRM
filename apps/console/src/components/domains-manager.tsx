"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { toast } from "@crm/ui/lib/toast";
import { actionErrorMessage } from "@crm/shared/auth-messages";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";

// Domain wizard for one workspace (FR-TEN-005, 05 §5.1): add → show DNS records → check →
// make main address → remove. All steps are re-authorized server-side (and re-auth is required
// for changes).

type Action = (input: unknown) => Promise<ActionResult<unknown>>;

export interface DomainRow {
  host: string;
  type: string;
  status: string;
  isCanonical: boolean;
  records: Array<{ type: string; name: string; value: string }>;
  error: string | null;
}

export function DomainsManager({
  tenantId,
  domains,
  actions,
}: {
  tenantId: string;
  domains: DomainRow[];
  actions: {
    add: Action;
    check: Action;
    setCanonical: Action;
    remove: Action;
    addSubdomain?: Action;
  };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<ActionResult<unknown>>, success: (d: unknown) => string) {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.host?.join(" ") ?? actionErrorMessage(result.error));
      return false;
    }
    toast.success(success(result.data));
    router.refresh();
    return true;
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const host = String(new FormData(form).get("host") ?? "");
    if (
      await run(
        () => actions.add({ tenantId, host }),
        () => t("console.domains.added"),
      )
    )
      form.reset();
  }

  const statusLabel = (s: string) => t(`console.domains.status.${s}` as MessageKey);

  return (
    <section aria-labelledby="domains-heading" className="flex flex-col gap-4">
      <h2 id="domains-heading" className="text-lg font-medium">
        {t("console.domains")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("console.domains.body")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {domains.map((d) => (
          <li
            key={d.host}
            className="flex flex-col gap-2 rounded-xl border p-3"
            data-domain={d.host}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-medium break-all">{d.host}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`console.domains.type.${d.type}` as MessageKey)} · {statusLabel(d.status)}
                  {d.isCanonical ? ` · ${t("console.domains.canonical")}` : ""}
                  {d.error ? ` · ${d.error}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.status !== "active" && d.type !== "platform_subdomain" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    aria-label={t("console.domains.check", { host: d.host })}
                    onClick={() =>
                      run(
                        () => actions.check({ tenantId, host: d.host }),
                        (data) =>
                          t("console.domains.checked", {
                            status: statusLabel((data as DomainRow).status),
                          }),
                      )
                    }
                  >
                    {t("console.domains.checkButton")}
                  </Button>
                ) : null}
                {d.status === "active" && !d.isCanonical ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    aria-label={t("console.domains.makeCanonical", { host: d.host })}
                    onClick={() =>
                      run(
                        () => actions.setCanonical({ tenantId, host: d.host }),
                        () => t("console.domains.canonicalSet"),
                      )
                    }
                  >
                    {t("console.domains.canonical")}
                  </Button>
                ) : null}
                {d.type !== "platform_subdomain" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    aria-label={t("console.domains.remove", { host: d.host })}
                    onClick={() =>
                      run(
                        () => actions.remove({ tenantId, host: d.host }),
                        () => t("console.domains.removed"),
                      )
                    }
                  >
                    ×
                  </Button>
                ) : null}
              </div>
            </div>
            {d.status !== "active" && d.records.length > 0 ? (
              <div
                className="overflow-x-auto"
                role="region"
                tabIndex={0}
                aria-label={t("console.domains.records", { host: d.host })}
              >
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th scope="col" className="pe-3">
                        {t("console.domains.recordType")}
                      </th>
                      <th scope="col" className="pe-3">
                        {t("console.domains.recordName")}
                      </th>
                      <th scope="col">{t("console.domains.recordValue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.records.map((r, i) => (
                      <tr key={i}>
                        <td className="pe-3 font-mono">{r.type}</td>
                        <td className="pe-3 font-mono break-all">{r.name}</td>
                        <td className="font-mono break-all">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="domain-host">{t("console.domains.host")}</Label>
          <Input
            id="domain-host"
            name="host"
            placeholder="crm.client.com"
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {t("console.domains.add")}
        </Button>
        {actions.addSubdomain ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => actions.addSubdomain!({ tenantId }),
                () => t("console.domains.added"),
              )
            }
          >
            {t("console.domains.addSubdomain")}
          </Button>
        ) : null}
      </form>
    </section>
  );
}
