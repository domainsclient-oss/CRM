"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { t } from "@crm/shared/i18n";

/** Date range for reports (≤ 12 months, validated server-side); state in the URL. */
export function RangeForm({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = new URLSearchParams(params.toString());
    next.set("from", String(data.get("from")));
    next.set("to", String(data.get("to")));
    router.push(`${pathname}?${next}`);
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="range-from">{t("reports.from")}</Label>
        <Input id="range-from" name="from" type="date" defaultValue={from} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="range-to">{t("reports.to")}</Label>
        <Input id="range-to" name="to" type="date" defaultValue={to} />
      </div>
      <Button type="submit" variant="outline">
        {t("reports.apply")}
      </Button>
    </form>
  );
}
