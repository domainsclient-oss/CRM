import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { AppError } from "@crm/core/errors";
import { t } from "@crm/shared/i18n";
import type { ListEntity } from "@crm/shared/records/list-specs";
import { isListEntity, nameOf } from "@/features/records/config";
import {
  can,
  getFormOptions,
  getFormatters,
  loadRecord,
  requireCtx,
  toFormValues,
} from "@/features/records/data";
import { RecordForm } from "@/features/records/record-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditRecordPage(props: PageProps<"/t/[host]/[entity]/[id]/edit">) {
  const { entity, id } = await props.params;
  if (!isListEntity(entity)) notFound();
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content entity={entity} id={id} />
    </Suspense>
  );
}

async function Content({ entity, id }: { entity: ListEntity; id: string }) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "record.update")) notFound();
  const record = await loadRecord(ctx, entity, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // Converted leads and closed deals' stages are read-only (FR-LEAD-002 AC3).
  if (entity === "leads" && record.status === "converted") notFound();
  const [options, fmt] = await Promise.all([getFormOptions(ctx, entity), getFormatters(ctx)]);
  const name = nameOf(entity, record);
  if (entity === "deals" && record.status !== "open") {
    options.stages = [{ id: String(record.stageId), label: String(record.status) }];
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("record.editTitle", { name })}</h1>
      <RecordForm
        key={record.updatedAt}
        entity={entity}
        id={record.id}
        expectedUpdatedAt={record.updatedAt}
        initial={toFormValues(entity, record, fmt.currency)}
        options={options}
        cancelHref={`/${entity}/${record.id}`}
      />
    </div>
  );
}
