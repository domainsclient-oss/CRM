import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import { AppError } from "@crm/core/errors";
import { getPipeline, openStages } from "@crm/core/records/deals";
import { conversionMatches } from "@crm/core/records/leads";
import { memberOptions } from "@crm/core/records/workspace-data";
import { workspaceScope } from "@crm/shared/permissions";
import { t, type MessageKey } from "@crm/shared/i18n";
import type { ListEntity } from "@crm/shared/records/list-specs";
import type { RelatedType } from "@crm/shared/records/schemas";
import { TYPE_OF, enumLabel, isListEntity, nameOf } from "@/features/records/config";
import { canAll, getFormatters, loadRecord, requireCtx } from "@/features/records/data";
import { DetailList, RelatedLink, RelatedSection, detailRows } from "@/features/records/detail";
import {
  ConvertLeadButton,
  DealCloseButtons,
  DeleteRecordButton,
  ReassignButton,
  ReopenDealButton,
  TaskDoneToggle,
} from "@/features/records/record-controls";
import { Timeline } from "@/features/records/timeline";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RecordPage(props: PageProps<"/t/[host]/[entity]/[id]">) {
  const { entity, id } = await props.params;
  if (!isListEntity(entity)) notFound();
  const tl = (await props.searchParams).tl;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Content entity={entity} id={id} timelineCursor={typeof tl === "string" ? tl : null} />
    </Suspense>
  );
}

function SectionFallback() {
  return <Skeleton className="h-32 w-full" aria-label={t("common.loading")} />;
}

async function Content({
  entity,
  id,
  timelineCursor,
}: {
  entity: ListEntity;
  id: string;
  timelineCursor: string | null;
}) {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const record = await loadRecord(ctx, entity, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const type = TYPE_OF[entity];
  const name = nameOf(entity, record);
  const ownerField = entity === "tasks" ? "assigneeUid" : "ownerUid";
  const ownsIt = record[ownerField] === ctx.uid;
  const scopeOf = (p: Parameters<typeof workspaceScope>[1]) => workspaceScope(ctx.role, p);
  const canOn = (p: Parameters<typeof workspaceScope>[1]) =>
    scopeOf(p) === "all" || (scopeOf(p) === "own" && ownsIt);
  const converted = entity === "leads" && record.status === "converted";
  const canEdit = canOn("record.update") && !converted;
  const fmt = await getFormatters(ctx);

  const controls: ReactNode[] = [];
  if (canEdit) {
    controls.push(
      <Button key="edit" variant="outline" asChild>
        <Link href={`/${entity}/${id}/edit`}>{t("record.edit")}</Link>
      </Button>,
    );
  }
  if (entity === "leads" && !converted && canOn("lead.convert")) {
    const matches = await conversionMatches(ctx, id);
    controls.push(
      <ConvertLeadButton
        key="convert"
        leadId={id}
        name={name}
        companyName={(record.companyName as string | null) ?? null}
        matches={matches}
        currencyHint={fmt.currency}
      />,
    );
  }
  if (entity === "deals" && canOn("record.update")) {
    if (record.status === "open") {
      controls.push(
        <DealCloseButtons
          key="close"
          id={id}
          name={name}
          hasContact={Boolean(record.primaryContactId)}
        />,
      );
    } else if (canAll(ctx, "record.update")) {
      const pipeline = await getPipeline(ctx);
      controls.push(
        <ReopenDealButton
          key="reopen"
          id={id}
          name={name}
          stages={openStages(pipeline).map((s) => ({ id: s.id, label: s.name }))}
        />,
      );
    }
  }
  if (canAll(ctx, "record.reassign") && !converted) {
    controls.push(
      <ReassignButton
        key="reassign"
        type={type}
        id={id}
        name={name}
        current={String(record[ownerField])}
        members={await memberOptions(ctx)}
      />,
    );
  }
  if (canOn("record.delete")) {
    controls.push(
      <DeleteRecordButton key="delete" type={type} id={id} name={name} listHref={`/${entity}`} />,
    );
  }

  const rows = await detailRows(ctx, entity, record);
  const convertedTo = record.convertedTo as
    { contactId: string; companyId: string | null; dealId: string | null } | null | undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href={`/${entity}`} className="text-sm underline-offset-4 hover:underline">
          ← {t("record.backToList", { entity: t(`entity.${entity}.plural` as MessageKey) })}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-3 text-2xl font-semibold break-words">
            {entity === "tasks" && canOn("record.update") ? (
              <TaskDoneToggle id={id} title={name} done={record.status === "done"} />
            ) : null}
            {name}
          </h1>
          <div className="flex flex-wrap gap-2">{controls}</div>
        </div>
        {converted ? (
          <p role="status" className="rounded-lg border p-3 text-sm">
            {t("lead.convertedNotice")}{" "}
            {convertedTo ? (
              <>
                <RelatedLink
                  ctx={ctx}
                  collection="contacts"
                  id={convertedTo.contactId}
                  label={t("lead.openContact")}
                />
                {convertedTo.dealId ? (
                  <>
                    {" · "}
                    <RelatedLink
                      ctx={ctx}
                      collection="deals"
                      id={convertedTo.dealId}
                      label={t("lead.openDeal")}
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        ) : null}
        {entity === "deals" && record.status !== "open" ? (
          <p role="status" className="rounded-lg border p-3 text-sm">
            {t("deal.closedNotice", {
              status: enumLabel("dealStatus", record.status).toLowerCase(),
            })}
          </p>
        ) : null}
        {!canEdit && !converted ? (
          <p className="text-sm text-muted-foreground">{t("record.readOnly")}</p>
        ) : null}
      </div>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="text-lg font-medium">
          {t("record.details")}
        </h2>
        <DetailList rows={rows} />
      </section>

      {entity === "companies" ? (
        <>
          <Suspense fallback={<SectionFallback />}>
            <RelatedSection
              ctx={ctx}
              entity="contacts"
              filter="company"
              value={id}
              sort="name"
              newHref={`/contacts/new?companyId=${id}`}
            />
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            <RelatedSection
              ctx={ctx}
              entity="deals"
              filter="company"
              value={id}
              newHref={`/deals/new?companyId=${id}`}
            />
          </Suspense>
        </>
      ) : null}
      {entity === "contacts" ? (
        <Suspense fallback={<SectionFallback />}>
          <RelatedSection
            ctx={ctx}
            entity="deals"
            filter="contact"
            value={id}
            newHref={`/deals/new?primaryContactId=${id}${record.companyId ? `&companyId=${String(record.companyId)}` : ""}`}
          />
        </Suspense>
      ) : null}
      {entity !== "tasks" ? (
        <>
          <Suspense fallback={<SectionFallback />}>
            <RelatedSection
              ctx={ctx}
              entity="tasks"
              filter="related"
              value={id}
              newHref={`/tasks/new?relatedType=${type}&relatedId=${id}`}
            />
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            <Timeline
              ctx={ctx}
              type={type as RelatedType}
              id={id}
              cursor={timelineCursor}
              basePath={`/${entity}/${id}`}
            />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}
