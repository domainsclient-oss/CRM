import Link from "next/link";
import type { ReactNode } from "react";
import type { TenantContext } from "@crm/core/contexts/tenant";
import { listRecords } from "@crm/core/records/list";
import { getById } from "@crm/core/repositories/base";
import { t, type MessageKey } from "@crm/shared/i18n";
import { parseListParams, type ListEntity } from "@crm/shared/records/list-specs";
import { RecordTable } from "./record-table";
import { enumLabel, nameOf } from "./config";
import { getFormatters, getMemberNames, stageNames, type Formatters } from "./data";

// Record detail building blocks (FR-COM-002): summary rows and related sections that load
// independently; a failing section shows an inline error instead of breaking the page.

type Rec = Record<string, unknown> & { id: string };

/** Link to a related record only if the viewer can see it (FR-RBAC-004 AC3); else plain label. */
export async function RelatedLink({
  ctx,
  collection,
  id,
  label,
}: {
  ctx: TenantContext;
  collection: "companies" | "contacts" | "deals" | "leads";
  id: unknown;
  label: unknown;
}) {
  if (typeof id !== "string" || !id) return <>—</>;
  const text = typeof label === "string" && label ? label : "—";
  const visible = await getById(ctx, collection, id).then(
    () => true,
    () => false,
  );
  if (visible) {
    return (
      <Link href={`/${collection}/${id}`} className="underline underline-offset-4">
        {text}
      </Link>
    );
  }
  return (
    <span>
      {text}{" "}
      <span className="text-muted-foreground">
        {collection === "companies" ? t("record.deletedCompany") : t("record.notVisible")}
      </span>
    </span>
  );
}

export function DetailList({ rows }: { rows: Array<[MessageKey, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{t(label)}</dt>
          <dd className="break-words">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export async function detailRows(
  ctx: TenantContext,
  entity: ListEntity,
  r: Rec,
): Promise<Array<[MessageKey, ReactNode]>> {
  const [fmt, members, stages] = await Promise.all([
    getFormatters(ctx),
    getMemberNames(ctx),
    entity === "deals" ? stageNames(ctx) : Promise.resolve({} as Record<string, string>),
  ]);
  const owner = members[String(r.ownerUid)] ?? "—";
  const tags = (r.tags as string[] | undefined)?.join(", ") || "—";
  const address = (a: unknown) => {
    const x = (a ?? {}) as Record<string, string | null>;
    return (
      [x.line1, x.line2, x.city, x.region, x.postalCode, x.country].filter(Boolean).join(", ") ||
      "—"
    );
  };
  const email = (v: unknown) =>
    typeof v === "string" && v ? (
      <a href={`mailto:${v}`} className="underline underline-offset-4">
        {v}
      </a>
    ) : (
      "—"
    );
  const tel = (v: unknown) =>
    typeof v === "string" && v ? (
      <a href={`tel:${v.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
        {v}
      </a>
    ) : (
      "—"
    );
  const common: Array<[MessageKey, ReactNode]> = [
    ["field.ownerUid", owner],
    ["field.tags", tags],
    [
      "field.updatedAt",
      <time key="u" dateTime={String(r.updatedAt)}>
        {fmt.dateTime(r.updatedAt)}
      </time>,
    ],
  ];
  switch (entity) {
    case "companies":
      return [
        ["field.domain", text(r.domain)],
        [
          "field.website",
          typeof r.website === "string" ? (
            <a
              href={r.website}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className="underline"
            >
              {r.website}
            </a>
          ) : (
            "—"
          ),
        ],
        ["field.phone", tel(r.phone)],
        ["field.industry", enumLabel("industry", r.industry)],
        ["field.sizeBand", text(r.sizeBand)],
        ["field.address", address(r.address)],
        ["field.description", text(r.description)],
        ...common,
      ];
    case "contacts":
      return [
        ["field.email", email(r.email)],
        [
          "field.phones",
          ((r.phones as Array<{ label: string; number: string }> | undefined) ?? []).length > 0 ? (
            <ul>
              {(r.phones as Array<{ label: string; number: string }>).map((p, i) => (
                <li key={i}>
                  {enumLabel("phoneLabel", p.label)}: {tel(p.number)}
                </li>
              ))}
            </ul>
          ) : (
            "—"
          ),
        ],
        ["field.jobTitle", text(r.jobTitle)],
        [
          "field.companyId",
          <RelatedLink
            key="c"
            ctx={ctx}
            collection="companies"
            id={r.companyId}
            label={r.companyName}
          />,
        ],
        ["field.lifecycleStage", enumLabel("stage", r.lifecycleStage)],
        ["field.leadSource", enumLabel("source", r.leadSource)],
        ["field.doNotContact", r.doNotContact ? "✓" : "—"],
        ["field.address", address(r.address)],
        ["field.notes", text(r.notes)],
        ["field.lastActivityAt", fmt.dateTime(r.lastActivityAt)],
        ...common,
      ];
    case "leads":
      return [
        ["field.email", email(r.email)],
        ["field.phone", tel(r.phone)],
        ["field.companyName", text(r.companyName)],
        ["field.jobTitle", text(r.jobTitle)],
        ["field.status", enumLabel("leadStatus", r.status)],
        ["field.source", enumLabel("source", r.source)],
        ["field.estimatedValue", fmt.money(r.estimatedValue)],
        ["field.notes", text(r.notes)],
        ...common,
      ];
    case "deals":
      return [
        ["field.amount", fmt.money(r.amount)],
        ["field.stageId", stages[String(r.stageId)] ?? "—"],
        ["field.status", enumLabel("dealStatus", r.status)],
        ["field.probability", text(r.probability)],
        ["field.expectedCloseDate", fmt.dateOnly(r.expectedCloseDate)],
        [
          "field.primaryContactId",
          <RelatedLink
            key="p"
            ctx={ctx}
            collection="contacts"
            id={r.primaryContactId}
            label={r.primaryContactName}
          />,
        ],
        [
          "field.companyId",
          <RelatedLink
            key="c"
            ctx={ctx}
            collection="companies"
            id={r.companyId}
            label={r.companyName}
          />,
        ],
        ...(r.status === "lost"
          ? ([
              ["field.lostReason", enumLabel("lostReason", r.lostReason)],
              ["field.lostReasonText", text(r.lostReasonText)],
            ] as Array<[MessageKey, ReactNode]>)
          : []),
        ...common,
      ];
    case "tasks": {
      const related = r.related as { type: string; id: string; label: string } | null;
      const collection = related
        ? ({ company: "companies", contact: "contacts", lead: "leads", deal: "deals" } as const)[
            related.type as "company"
          ]
        : null;
      return [
        [
          "field.dueAt",
          r.dueDate
            ? r.dueIsDateOnly
              ? fmt.dateOnly(`${String(r.dueDate)}T00:00:00Z`)
              : fmt.dateTime(r.dueAt)
            : "—",
        ],
        ["field.priority", enumLabel("priority", r.priority)],
        ["field.status", enumLabel("taskStatus", r.status)],
        ["field.assigneeUid", members[String(r.assigneeUid)] ?? "—"],
        [
          "field.related",
          related && collection ? (
            <RelatedLink
              key="r"
              ctx={ctx}
              collection={collection}
              id={related.id}
              label={related.label}
            />
          ) : (
            "—"
          ),
        ],
        ["field.description", text(r.description)],
        ["field.updatedAt", fmt.dateTime(r.updatedAt)],
      ];
    }
  }
}

/** A related list (e.g. a company's contacts), own-scoped like every list. */
export async function RelatedSection({
  ctx,
  entity,
  filter,
  value,
  sort,
  newHref,
}: {
  ctx: TenantContext;
  entity: ListEntity;
  filter: string;
  value: string;
  sort?: string;
  newHref?: string;
}) {
  const title = t(`entity.${entity}.plural` as MessageKey);
  const loaded = await Promise.all([
    listRecords<Rec>(ctx, entity, {
      ...parseListParams(entity, { filter, value, ...(sort ? { sort } : {}) }),
      pageSize: 10,
    }),
    getFormatters(ctx),
    getMemberNames(ctx),
    entity === "deals" ? stageNames(ctx) : Promise.resolve({} as Record<string, string>),
  ]).catch(() => null);
  if (!loaded) {
    return (
      <section className="flex flex-col gap-2" aria-label={title}>
        <h2 className="text-lg font-medium">{title}</h2>
        <p role="alert" className="text-sm text-destructive">
          {t("record.sectionError")}
        </p>
      </section>
    );
  }
  const [page, fmt, members, stages] = loaded;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium">
          {title} <span className="text-sm text-muted-foreground">({page.total})</span>
        </h2>
        {newHref ? (
          <Link href={newHref} className="text-sm underline underline-offset-4">
            {t(`entity.${entity}.new` as MessageKey)}
          </Link>
        ) : null}
      </div>
      {page.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      ) : (
        <RecordTable
          entity={entity}
          rows={page.items}
          lookups={{ fmt, members, stages }}
          label={t("list.records", { entity: title })}
        />
      )}
      {page.total > page.items.length ? (
        <Link
          href={`/${entity}?filter=${filter}&value=${encodeURIComponent(value)}`}
          className="text-sm underline underline-offset-4"
        >
          {t("list.next")}
        </Link>
      ) : null}
    </section>
  );
}

export { nameOf };
export type { Formatters };
