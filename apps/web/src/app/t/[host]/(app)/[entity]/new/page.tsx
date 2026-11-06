import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Skeleton } from "@crm/ui/components/skeleton";
import { t, type MessageKey } from "@crm/shared/i18n";
import type { ListEntity } from "@crm/shared/records/list-specs";
import { RELATED_TYPES } from "@crm/shared/records/schemas";
import { isListEntity } from "@/features/records/config";
import { can, getFormOptions, requireCtx } from "@/features/records/data";
import { RecordForm } from "@/features/records/record-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function NewRecordPage(props: PageProps<"/t/[host]/[entity]/new">) {
  const { entity } = await props.params;
  if (!isListEntity(entity)) notFound();
  const searchParams = await props.searchParams;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content entity={entity} searchParams={searchParams} />
    </Suspense>
  );
}

/** Prefill from links on detail pages (e.g. "New deal" on a company). IDs only; server re-checks. */
function prefill(entity: ListEntity, q: Record<string, string | string[] | undefined>) {
  const id = (key: string) => {
    const v = q[key];
    return typeof v === "string" && ID.test(v) ? v : undefined;
  };
  const values: Record<string, unknown> = {};
  if (entity === "contacts" || entity === "deals") values.companyId = id("companyId");
  if (entity === "deals") values.primaryContactId = id("primaryContactId");
  if (entity === "tasks") {
    const type = q.relatedType;
    const relId = id("relatedId");
    if (typeof type === "string" && (RELATED_TYPES as readonly string[]).includes(type) && relId) {
      values.related = { type, id: relId };
    }
  }
  return values;
}

async function Content({
  entity,
  searchParams,
}: {
  entity: ListEntity;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  if (!can(ctx, "record.create")) notFound();
  const options = await getFormOptions(ctx, entity);
  const title = t(`entity.${entity}.new` as MessageKey);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <RecordForm
        entity={entity}
        id={null}
        expectedUpdatedAt={null}
        initial={{
          ownerUid: ctx.uid,
          assigneeUid: ctx.uid,
          ...prefill(entity, searchParams),
        }}
        options={options}
        cancelHref={`/${entity}`}
      />
    </div>
  );
}
