import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import { getPipeline } from "@crm/core/records/deals";
import { listRecords } from "@crm/core/records/list";
import { listTags, recordOptions } from "@crm/core/records/workspace-data";
import { t, type MessageKey } from "@crm/shared/i18n";
import { LIST_SPECS, parseListParams, type ListEntity } from "@crm/shared/records/list-specs";
import { enumLabel, isListEntity } from "@/features/records/config";
import {
  can,
  canAll,
  getFormatters,
  getMemberNames,
  requireCtx,
  stageNames,
} from "@/features/records/data";
import { ExportListButton } from "@/features/data/export-button";
import { ListToolbar, type ToolbarFilter } from "@/features/records/list-toolbar";
import { Pagination, RecordTable } from "@/features/records/record-table";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const ENUM_PREFIX: Record<string, string> = {
  "contacts.stage": "stage",
  "leads.status": "leadStatus",
  "leads.source": "source",
  "deals.status": "dealStatus",
  "tasks.status": "taskStatus",
};

export default async function ListPage(props: PageProps<"/t/[host]/[entity]">) {
  const { entity } = await props.params;
  if (!isListEntity(entity)) notFound();
  const searchParams = await props.searchParams;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content entity={entity} searchParams={searchParams} />
    </Suspense>
  );
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
  const params = parseListParams(entity, searchParams);
  const [page, fmt, members, stages] = await Promise.all([
    listRecords<Record<string, unknown> & { id: string }>(ctx, entity, params),
    getFormatters(ctx),
    getMemberNames(ctx),
    entity === "deals" ? stageNames(ctx) : Promise.resolve({} as Record<string, string>),
  ]);

  const ownScope = !canAll(ctx, "record.read");
  const filters: ToolbarFilter[] = [];
  for (const spec of LIST_SPECS[entity].filters) {
    if (spec.kind === "member") {
      if (ownScope) continue; // Members only ever see their own records
      filters.push({
        id: spec.id,
        options: Object.entries(members).map(([id, label]) => ({ id, label })),
      });
    } else if (spec.kind === "enum") {
      const prefix = ENUM_PREFIX[`${entity}.${spec.id}`] ?? "";
      filters.push({
        id: spec.id,
        options: (spec.values ?? []).map((v) => ({ id: v, label: enumLabel(prefix, v) })),
      });
    } else if (spec.kind === "tag") {
      filters.push({
        id: spec.id,
        options: (await listTags(ctx)).map((tag) => ({ id: tag, label: tag })),
      });
    } else if (spec.id === "company") {
      filters.push({ id: spec.id, options: await recordOptions(ctx, "companies") });
    } else if (spec.id === "contact") {
      filters.push({ id: spec.id, options: await recordOptions(ctx, "contacts") });
    } else if (spec.id === "stage" && entity === "deals") {
      const pipeline = await getPipeline(ctx);
      filters.push({
        id: spec.id,
        options: pipeline.stages.map((s) => ({ id: s.id, label: s.name })),
      });
    }
  }

  const isCustomers =
    entity === "contacts" &&
    params.filter?.spec.id === "stage" &&
    params.filter.value === "customer";
  const title = isCustomers
    ? t("entity.customers.plural")
    : t(`entity.${entity}.plural` as MessageKey);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="flex gap-2">
          {entity === "deals" ? (
            <Button variant="outline" asChild>
              <Link href="/pipeline">{t("nav.pipeline")}</Link>
            </Button>
          ) : null}
          {can(ctx, "record.export") ? (
            <ExportListButton
              entity={entity}
              query={{
                sort: params.sort.id,
                ...(params.filter
                  ? { filter: params.filter.spec.id, value: params.filter.value }
                  : {}),
              }}
            />
          ) : null}
          {can(ctx, "record.create") ? (
            <Button asChild>
              <Link href={`/${entity}/new`}>{t(`entity.${entity}.new` as MessageKey)}</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <ListToolbar
        entity={entity}
        sorts={LIST_SPECS[entity].sorts.map((s) => s.id)}
        filters={filters}
        current={{
          sort: params.sort.id,
          filter: params.filter?.spec.id ?? null,
          value: params.filter?.value ?? null,
        }}
      />
      <p className="text-sm text-muted-foreground" role="status">
        {t("list.total", { count: page.total })}
        {ownScope ? ` · ${t("app.ownRecords")}` : ""}
      </p>
      {page.items.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-muted-foreground">
          {page.emptyCollection ? t("list.empty") : t("list.emptyFiltered")}
        </p>
      ) : (
        <RecordTable
          entity={entity}
          rows={page.items}
          lookups={{ fmt, members, stages }}
          label={t("list.records", { entity: title })}
        />
      )}
      <Pagination
        entity={entity}
        params={params}
        nextCursor={page.nextCursor}
        basePath={`/${entity}`}
      />
    </div>
  );
}
