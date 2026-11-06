import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import { loadBoard } from "@crm/core/records/deals";
import { workspaceScope } from "@crm/shared/permissions";
import { t } from "@crm/shared/i18n";
import { getFormatters, getMemberNames, requireCtx } from "@/features/records/data";
import { Kanban } from "@/features/records/kanban";

export const metadata: Metadata = {
  title: t("deal.board"),
  robots: { index: false, follow: false },
};

export default function PipelinePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" aria-label={t("common.loading")} />}>
      <Board />
    </Suspense>
  );
}

async function Board() {
  const ctx = await requireCtx();
  if (!ctx) return null;
  const [board, fmt, members] = await Promise.all([
    loadBoard(ctx),
    getFormatters(ctx),
    getMemberNames(ctx),
  ]);
  const scope = workspaceScope(ctx.role, "record.update");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("deal.board")}</h1>
          <p className="text-sm text-muted-foreground">{t("deal.boardHint")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/deals">{t("deal.listView")}</Link>
          </Button>
          {workspaceScope(ctx.role, "record.create") ? (
            <Button asChild>
              <Link href="/deals/new">{t("entity.deals.new")}</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <Kanban
        // Remount after router.refresh() so server state replaces optimistic state.
        key={board.columns
          .map((c) => `${c.stage.id}:${c.count}:${c.deals.map((d) => d.id).join(",")}`)
          .join("|")}
        currency={fmt.currency}
        locale={fmt.locale}
        columns={board.columns.map((c) => ({
          stage: { id: c.stage.id, name: c.stage.name },
          count: c.count,
          sum: c.sum,
          cards: c.deals.map((d) => ({
            id: d.id,
            name: String(d.name),
            amount: typeof d.amount === "number" ? d.amount : 0,
            owner: members[String(d.ownerUid)] ?? "",
            contact: (d.primaryContactName as string | null) ?? null,
            canMove: scope === "all" || (scope === "own" && d.ownerUid === ctx.uid),
          })),
        }))}
      />
    </div>
  );
}
