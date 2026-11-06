import Link from "next/link";
import { t } from "@crm/shared/i18n";
import { listQuery, type ListEntity, type ListParams } from "@crm/shared/records/list-specs";
import { LIST_COLUMNS, enumLabel, nameOf, pick, type ColumnSpec } from "./config";
import type { Formatters } from "./data";

// Server-rendered list table + cursor pagination (T-04-01). Rows link to record detail pages.

type Row = Record<string, unknown> & { id: string };

interface Lookups {
  fmt: Formatters;
  members: Record<string, string>;
  stages: Record<string, string>;
}

function cell(entity: ListEntity, col: ColumnSpec, row: Row, lookups: Lookups) {
  const value = col.key === "name" ? null : pick(row, col.key);
  switch (col.kind) {
    case "name":
      return (
        <Link
          href={`/${entity}/${row.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {nameOf(entity, row) || t("record.chooseNone")}
        </Link>
      );
    case "email":
      return value ? <span className="break-all">{String(value)}</span> : "—";
    case "member":
      return value ? (lookups.members[String(value)] ?? "—") : "—";
    case "date":
      return typeof value === "string" ? (
        <time dateTime={value}>{lookups.fmt.date(value)}</time>
      ) : (
        "—"
      );
    case "dateOnly":
      return typeof value === "string" ? (
        <time dateTime={value.slice(0, 10)}>{lookups.fmt.dateOnly(value)}</time>
      ) : (
        "—"
      );
    case "due": {
      if (!row.dueDate) return "—";
      return row.dueIsDateOnly
        ? lookups.fmt.dateOnly(`${String(row.dueDate)}T00:00:00Z`)
        : lookups.fmt.dateTime(value);
    }
    case "money":
      return lookups.fmt.money(value);
    case "enum":
      return enumLabel(col.enumPrefix ?? "", value);
    case "stage":
      return value ? (lookups.stages[String(value)] ?? "—") : "—";
    case "count":
      return typeof value === "number" ? value : 0;
    case "related": {
      const related = row.related as { type: string; id: string; label: string } | null;
      return related ? related.label : "—";
    }
    case "text":
      return value ? String(value) : "—";
  }
}

export function RecordTable({
  entity,
  rows,
  lookups,
  label,
}: {
  entity: ListEntity;
  rows: Row[];
  lookups: Lookups;
  label: string;
}) {
  const columns = LIST_COLUMNS[entity];
  // Phones: card list (primary field + three key fields); md and up: full table (06 §7).
  const cardFields = columns.slice(1, 4);
  return (
    <>
      <ul aria-label={label} className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border p-3">
            <div className="text-base">{cell(entity, columns[0]!, row, lookups)}</div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              {cardFields.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted-foreground">{t(c.label)}</dt>
                  <dd className="min-w-0 break-words">{cell(entity, c, row, lookups)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div
        className="hidden overflow-x-auto rounded-xl border md:block"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {t(c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                {columns.map((c, i) =>
                  i === 0 ? (
                    <th key={c.key} scope="row" className="px-3 py-2 text-left font-normal">
                      {cell(entity, c, row, lookups)}
                    </th>
                  ) : (
                    <td key={c.key} className="px-3 py-2">
                      {cell(entity, c, row, lookups)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Pagination({
  entity,
  params,
  nextCursor,
  basePath,
}: {
  entity: ListEntity;
  params: ListParams;
  nextCursor: string | null;
  basePath: string;
}) {
  const base = {
    sort: params.sort.id,
    ...(params.filter ? { filter: params.filter.spec.id, value: params.filter.value } : {}),
  };
  const prevCursor = params.trail.at(-1);
  const prev = params.cursor
    ? `${basePath}${listQuery(entity, {
        ...base,
        cursor: prevCursor && prevCursor !== "0" ? prevCursor : null,
        trail: params.trail.slice(0, -1),
      })}`
    : null;
  const next = nextCursor
    ? `${basePath}${listQuery(entity, {
        ...base,
        cursor: nextCursor,
        trail: [...params.trail, params.cursor ?? "0"],
      })}`
    : null;
  if (!prev && !next) return null;
  return (
    <nav aria-label={t("list.pagination")} className="flex justify-between gap-3">
      {prev ? (
        <Link href={prev} className="text-sm underline underline-offset-4">
          {t("list.previous")}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next} className="text-sm underline underline-offset-4">
          {t("list.next")}
        </Link>
      ) : null}
    </nav>
  );
}
