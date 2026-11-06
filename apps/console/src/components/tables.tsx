import Link from "next/link";
import type { AgencySummary, WorkspaceAdminSummary } from "@crm/core/services/admin";
import type { ActionResult } from "@crm/shared/errors";
import { t, type MessageKey } from "@crm/shared/i18n";
import { StatusButton } from "./status-button";

type StatusAction = (input: unknown) => Promise<ActionResult<unknown>>;

function statusLabel(status: string): string {
  return t(`console.status.${status}` as MessageKey);
}

export function AgenciesTable({
  agencies,
  setStatus,
}: {
  agencies: AgencySummary[];
  setStatus: StatusAction;
}) {
  if (agencies.length === 0)
    return <p className="text-sm text-muted-foreground">{t("console.empty")}</p>;
  return (
    <div
      className="overflow-x-auto rounded-xl border"
      tabIndex={0}
      role="region"
      aria-label={t("console.list.agencies")}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{t("console.agencies")}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">
              {t("console.col.name")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("console.col.workspaces")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("console.col.status")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("console.col.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {agencies.map((a) => (
            <tr key={a.id} className="border-t">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {a.name}
              </th>
              <td className="px-3 py-2 tabular-nums">
                {a.workspaces} / {a.maxWorkspaces}
              </td>
              <td className="px-3 py-2">{statusLabel(a.status)}</td>
              <td className="px-3 py-2">
                <StatusButton
                  label={a.name}
                  status={a.status}
                  action={setStatus}
                  idField="agencyId"
                  id={a.id}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkspacesTable({
  workspaces,
  agencyNames,
  setStatus,
}: {
  workspaces: WorkspaceAdminSummary[];
  agencyNames?: Record<string, string> | undefined;
  setStatus: StatusAction;
}) {
  if (workspaces.length === 0)
    return <p className="text-sm text-muted-foreground">{t("console.empty")}</p>;
  return (
    <div
      className="overflow-x-auto rounded-xl border"
      tabIndex={0}
      role="region"
      aria-label={t("console.list.workspaces")}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{t("console.workspaces")}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">
              {t("console.col.name")}
            </th>
            {agencyNames ? (
              <th scope="col" className="px-3 py-2">
                {t("console.col.agency")}
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2">
              {t("console.col.host")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("console.col.status")}
            </th>
            <th scope="col" className="px-3 py-2">
              {t("console.col.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {workspaces.map((w) => (
            <tr key={w.id} className="border-t">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                <Link href={`/workspaces/${w.id}`} className="underline-offset-4 hover:underline">
                  {w.name}
                </Link>
              </th>
              {agencyNames ? <td className="px-3 py-2">{agencyNames[w.agencyId] ?? "—"}</td> : null}
              <td className="px-3 py-2 break-all">{w.host}</td>
              <td className="px-3 py-2">{statusLabel(w.status)}</td>
              <td className="px-3 py-2">
                <StatusButton
                  label={w.name}
                  status={w.status}
                  action={setStatus}
                  idField="tenantId"
                  id={w.id}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
