"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@crm/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crm/ui/components/dialog";
import { Input } from "@crm/ui/components/input";
import { t, type MessageKey } from "@crm/shared/i18n";
import { searchAction } from "./actions";

// Global search (FR-SRCH-001): Ctrl/Cmd+K, debounced 250 ms, grouped results (max 5 each).

type Hit = { entity: string; id: string; label: string; detail: string | null };
type Results = Record<"contacts" | "companies" | "leads" | "deals", Hit[]>;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const result = await searchAction({ q });
      if (mine === seq.current && result.ok) setResults(result.data as Results);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  // Below 2 characters nothing is shown (stale results are hidden, not cleared in an effect).
  const shown = q.trim().length >= 2 ? results : null;
  const total = shown ? Object.values(shown).reduce((n, list) => n + list.length, 0) : 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("search.open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("search.title")}</DialogTitle>
            <DialogDescription id="search-hint">{t("search.hint")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            type="search"
            aria-label={t("search.label")}
            aria-describedby="search-hint"
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
          />
          <p role="status" className="sr-only">
            {shown ? t("search.results", { count: total }) : ""}
          </p>
          {shown ? (
            total === 0 ? (
              <p className="text-sm text-muted-foreground">{t("search.noResults")}</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
                {(Object.keys(shown) as Array<keyof Results>).map((entity) =>
                  shown[entity].length === 0 ? null : (
                    <section key={entity} aria-label={t(`entity.${entity}.plural` as MessageKey)}>
                      <h3 className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                        {t(`entity.${entity}.plural` as MessageKey)}
                      </h3>
                      <ul className="flex flex-col">
                        {shown[entity].map((hit) => (
                          <li key={hit.id}>
                            <Link
                              href={`/${entity}/${hit.id}`}
                              className="flex flex-col rounded-md px-2 py-1.5 hover:bg-muted focus-visible:bg-muted"
                              onClick={() => setOpen(false)}
                            >
                              <span className="font-medium">{hit.label}</span>
                              {hit.detail ? (
                                <span className="text-xs text-muted-foreground">{hit.detail}</span>
                              ) : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={`/${entity}`}
                        className="inline-flex min-h-6 items-center px-2 text-xs underline underline-offset-4"
                        onClick={() => setOpen(false)}
                      >
                        {t("search.seeAll", {
                          entity: t(`entity.${entity}.plural` as MessageKey).toLowerCase(),
                        })}
                      </Link>
                    </section>
                  ),
                )}
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
