import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Skeleton } from "@crm/ui/components/skeleton";
import { AUDIT_ACTIONS } from "@crm/core/audit";
import { listAudit } from "@crm/core/audit-viewer";
import { getEffectiveConfig } from "@crm/core/config/entitlements";
import { t } from "@crm/shared/i18n";
import { can, getFormatters, getMemberNames, requireCtx } from "@/features/records/data";
import { AuditFilters, AuditExportButton } from "@/features/data/audit-controls";

export const metadata: Metadata = {
  title: t("audit.title"),
  robots: { index: false, follow: false },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function AuditPage(props: PageProps<"/t/[host]/settings/audit">) {
  const q = await props.searchParams;
  const s = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
  const action = s("action");
  const filter = {
    action: action && (AUDIT_ACTIONS as readonly string[]).includes(action) ? action : null,
    actorUid: !action && s("actor") && ID.test(s("actor")!) ? s("actor") : null,
    from: s("from") && DATE.test(s("from")!) ? s("from") : null,
    to: s("to") && DATE.test(s("to")!) ? s("to") : null,
  };
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content filter={filter} cursor={s("cursor")} />
    </Suspense>
  );
}

// FR-AUD-002: Owner/Admin, allowlisted filters, cursor pagination, CSV with auditExport.
async function Content({
  filter,
  cursor,
}: {
  filter: {
    action: string | null;
    actorUid: string | null;
    from: string | null;
    to: string | null;
  };
  cursor: string | null;
}) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "audit.read")) notFound();
  const [page, fmt, members, config] = await Promise.all([
    listAudit(ctx, filter, cursor),
    getFormatters(ctx),
    getMemberNames(ctx),
    getEffectiveConfig(ctx),
  ]);
  const params = new URLSearchParams(
    Object.entries({
      action: filter.action,
      actor: filter.actorUid,
      from: filter.from,
      to: filter.to,
    }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("audit.title")}</h1>
      <AuditFilters actions={[...AUDIT_ACTIONS]} members={members} current={filter} />
      {config.features.auditExport ? (
        <AuditExportButton filter={filter} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("audit.exportDisabled")}</p>
      )}
      <div
        className="overflow-x-auto rounded-xl border"
        role="region"
        tabIndex={0}
        aria-label={t("audit.title")}
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {[
                t("audit.when"),
                t("audit.action"),
                t("audit.actor"),
                t("audit.target"),
                t("audit.fields"),
              ].map((h) => (
                <th key={h} scope="col" className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <th scope="row" className="px-3 py-2 text-left font-normal whitespace-nowrap">
                  {fmt.dateTime(r.createdAt)}
                </th>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2">
                  {r.actorUid ? (members[r.actorUid] ?? r.actorUid) : r.actorType}
                </td>
                <td className="px-3 py-2 break-all">
                  {r.targetType}:{r.targetId}
                </td>
                <td className="px-3 py-2">{r.changedFields.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.nextCursor ? (
        <Link
          href={`/settings/audit?${new URLSearchParams([...params, ["cursor", page.nextCursor]])}`}
          className="text-sm underline underline-offset-4"
        >
          {t("list.next")}
        </Link>
      ) : null}
    </div>
  );
}
