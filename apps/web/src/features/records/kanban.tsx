"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type DragEvent } from "react";
import { NativeSelect } from "@crm/ui/components/native-select";
import { toast } from "@crm/ui/lib/toast";
import { t } from "@crm/shared/i18n";
import { formatMoney } from "@crm/shared/records/money";
import { moveDealStageAction } from "./actions";

// Pipeline board (FR-DEAL-003). Drag-and-drop moves deals; every card also has a keyboard-
// operable "Move to stage" select (WCAG 2.5.7). Moves are optimistic and roll back with an
// error toast if the server refuses. Columns scroll horizontally with snap on small screens.

export interface BoardCard {
  id: string;
  name: string;
  amount: number;
  owner: string;
  contact: string | null;
  canMove: boolean;
}
export interface BoardColumnData {
  stage: { id: string; name: string };
  cards: BoardCard[];
  count: number;
  sum: number;
}

export function Kanban({
  columns: initial,
  currency,
  locale,
}: {
  columns: BoardColumnData[];
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const stages = columns.map((c) => c.stage);

  async function move(cardId: string, toStage: string) {
    const from = columns.find((c) => c.cards.some((d) => d.id === cardId));
    const card = from?.cards.find((d) => d.id === cardId);
    if (!from || !card || from.stage.id === toStage || !card.canMove) return;
    const snapshot = columns;
    setColumns((cols) =>
      cols.map((c) => {
        if (c.stage.id === from.stage.id) {
          return {
            ...c,
            cards: c.cards.filter((d) => d.id !== cardId),
            count: c.count - 1,
            sum: c.sum - card.amount,
          };
        }
        if (c.stage.id === toStage) {
          return { ...c, cards: [card, ...c.cards], count: c.count + 1, sum: c.sum + card.amount };
        }
        return c;
      }),
    );
    const result = await moveDealStageAction({ id: cardId, stageId: toStage });
    if (!result.ok) {
      setColumns(snapshot);
      toast.error(t("deal.moveFailed"));
      return;
    }
    toast.success(t("deal.moved", { stage: stages.find((s) => s.id === toStage)?.name ?? "" }));
    router.refresh();
  }

  function onDrop(event: DragEvent<HTMLElement>, stageId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    setDragging(null);
    setDropTarget(null);
    if (id) void move(id, stageId);
  }

  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
      role="region"
      aria-label={t("deal.board")}
      tabIndex={0}
    >
      {columns.map((col) => (
        <section
          key={col.stage.id}
          aria-labelledby={`col-${col.stage.id}`}
          className={`flex w-[85vw] max-w-72 shrink-0 snap-start flex-col gap-2 rounded-xl border bg-muted/30 p-2 sm:w-72 ${
            dropTarget === col.stage.id ? "ring-2 ring-ring" : ""
          }`}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setDropTarget(col.stage.id);
          }}
          onDragLeave={() => setDropTarget((s) => (s === col.stage.id ? null : s))}
          onDrop={(e) => onDrop(e, col.stage.id)}
          data-stage={col.stage.id}
        >
          <header className="px-1">
            <h2 id={`col-${col.stage.id}`} className="font-medium">
              {col.stage.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("deal.columnSummary", {
                count: col.count,
                sum: formatMoney(col.sum, currency, locale),
              })}
            </p>
          </header>
          {col.cards.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-muted-foreground">
              {t("deal.emptyColumn")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {col.cards.map((card) => (
                <li
                  key={card.id}
                  draggable={card.canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", card.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(card.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  className={`flex flex-col gap-1.5 rounded-lg border bg-background p-2 shadow-xs ${
                    dragging === card.id ? "opacity-50" : ""
                  } ${card.canMove ? "cursor-grab" : ""}`}
                  data-deal={card.id}
                >
                  <Link
                    href={`/deals/${card.id}`}
                    className="font-medium break-words underline-offset-4 hover:underline"
                  >
                    {card.name}
                  </Link>
                  <p className="text-sm">{formatMoney(card.amount, currency, locale)}</p>
                  <p className="text-xs text-muted-foreground">
                    {[card.contact, card.owner].filter(Boolean).join(" · ")}
                  </p>
                  {card.canMove ? (
                    <NativeSelect
                      aria-label={t("deal.moveTo", { name: card.name })}
                      value={col.stage.id}
                      onChange={(e) => void move(card.id, e.target.value)}
                      className="h-8 text-sm"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {col.count > col.cards.length ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t("deal.moreInColumn", { shown: col.cards.length, count: col.count })}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
