"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Label } from "@crm/ui/components/label";
import { NativeSelect } from "@crm/ui/components/native-select";
import { t, type MessageKey } from "@crm/shared/i18n";
import { listQuery, type ListEntity } from "@crm/shared/records/list-specs";

// Filter + sort controls (FR-SRCH-002). Only allowlisted filters/sorts are offered; state lives
// in the URL so a view is shareable within the workspace. One filter at a time.

export interface ToolbarFilter {
  id: string;
  options: Array<{ id: string; label: string }>;
}

interface Props {
  entity: ListEntity;
  sorts: string[];
  filters: ToolbarFilter[];
  current: { sort: string; filter: string | null; value: string | null };
}

export function ListToolbar({ entity, sorts, filters, current }: Props) {
  const router = useRouter();
  const [filterId, setFilterId] = useState(current.filter ?? "");
  const active = filters.find((f) => f.id === filterId);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const filter = String(data.get("filter") ?? "");
    const value = String(data.get("value") ?? "");
    router.push(
      `/${entity}${listQuery(entity, {
        sort: String(data.get("sort") ?? ""),
        ...(filter && value ? { filter, value } : {}),
      })}`,
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={t("list.filters")}
      className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex min-w-40 flex-col gap-1.5">
        <Label htmlFor="list-sort">{t("list.sort")}</Label>
        <NativeSelect id="list-sort" name="sort" defaultValue={current.sort}>
          {sorts.map((s) => (
            <option key={s} value={s}>
              {t(`list.sort.${s}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {filters.length > 0 ? (
        <>
          <div className="flex min-w-40 flex-col gap-1.5">
            <Label htmlFor="list-filter">{t("list.filter")}</Label>
            <NativeSelect
              id="list-filter"
              name="filter"
              value={filterId}
              onChange={(e) => setFilterId(e.target.value)}
            >
              <option value="">{t("list.filterNone")}</option>
              {filters.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(`list.filter.${f.id}` as MessageKey)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {active ? (
            <div className="flex min-w-48 flex-col gap-1.5">
              <Label htmlFor="list-value">{t(`list.filter.${active.id}` as MessageKey)}</Label>
              <NativeSelect
                id="list-value"
                name="value"
                key={active.id}
                defaultValue={current.filter === active.id ? (current.value ?? "") : ""}
                required
              >
                <option value="" disabled>
                  {t("record.choose")}
                </option>
                {active.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit">{t("list.apply")}</Button>
        {current.filter ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/${entity}${listQuery(entity, { sort: current.sort })}`)}
          >
            {t("list.clearFilter")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
