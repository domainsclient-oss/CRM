import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { listTrash } from "@crm/core/records/trash";
import { t, type MessageKey } from "@crm/shared/i18n";
import { ENTITY_OF, type RecordTypeName } from "@/features/records/config";
import { can, getFormatters, getMemberNames, requireCtx } from "@/features/records/data";
import { TrashRowActions } from "@/features/records/trash-actions";

export const metadata: Metadata = {
  title: t("trash.title"),
  robots: { index: false, follow: false },
};

const TYPES: RecordTypeName[] = ["contact", "company", "lead", "deal", "task"];

export default async function TrashPage(props: PageProps<"/t/[host]/trash">) {
  const q = await props.searchParams;
  const type = TYPES.find((ty) => ty === q.type) ?? "contact";
  const cursor = typeof q.cursor === "string" ? q.cursor : null;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content type={type} cursor={cursor} />
    </Suspense>
  );
}

// FR-REC-001: Manager+ restore or purge; records auto-purge after 30 days.
async function Content({ type, cursor }: { type: RecordTypeName; cursor: string | null }) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "record.restore")) notFound();
  const [page, fmt, members] = await Promise.all([
    listTrash(ctx, type, cursor),
    getFormatters(ctx),
    getMemberNames(ctx),
  ]);
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("trash.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("trash.body")}</p>
      <nav aria-label={t("trash.types")} className="flex flex-wrap gap-2">
        {TYPES.map((ty) => {
          const entity = ENTITY_OF[ty];
          return (
            <Link
              key={ty}
              href={`/trash?type=${ty}`}
              aria-current={ty === type ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                ty === type ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              {t(`entity.${entity}.plural` as MessageKey)}
            </Link>
          );
        })}
      </nav>
      {page.items.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-muted-foreground">
          {t("trash.empty")}
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-xl border"
          role="region"
          tabIndex={0}
          aria-label={t("trash.title")}
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t("field.name")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("trash.deletedAt")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("team.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {item.label || "—"}
                  </th>
                  <td className="px-3 py-2">
                    {fmt.dateTime(item.deletedAt)}
                    {item.deletedBy ? ` · ${members[item.deletedBy] ?? ""}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <TrashRowActions type={type} id={item.id} name={item.label || "—"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <Link
          href={`/trash?type=${type}&cursor=${encodeURIComponent(page.nextCursor)}`}
          className="text-sm underline underline-offset-4"
        >
          {t("list.next")}
        </Link>
      ) : null}
    </div>
  );
}
