"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@crm/ui/components/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@crm/ui/components/dialog";
import { t, type MessageKey } from "@crm/shared/i18n";
import { markReadAction, notificationsAction, unreadCountAction } from "./actions";

// In-app notifications (FR-NOTF-001): unread count polled every 60 s and on navigation (ADR-003);
// the panel lists the user's own notifications in this workspace only.

type Item = {
  id: string;
  type: string;
  title: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    const result = await unreadCountAction({});
    if (result.ok) setUnread((result.data as { unread: number }).unread);
  }, []);

  // Poll every 60 s and once shortly after each navigation (ADR-003). Hidden tabs don't poll
  // (each poll costs reads, T-08-06); the count refreshes when the tab becomes visible again.
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const first = setTimeout(() => void refreshCount(), 0);
    const timer = setInterval(() => {
      if (visible()) void refreshCount();
    }, 60_000);
    const onVisibility = () => {
      if (visible()) void refreshCount();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname, refreshCount]);

  async function load(next: string | null) {
    const result = await notificationsAction({ cursor: next });
    if (!result.ok) return;
    const data = result.data as { items: Item[]; nextCursor: string | null; unread: number };
    setItems((prev) => (next ? [...prev, ...data.items] : data.items));
    setCursor(data.nextCursor);
    setUnread(data.unread);
  }

  async function mark(id: string) {
    await markReadAction({ id });
    if (id === "all") setItems((list) => list.map((i) => ({ ...i, readAt: i.readAt ?? "now" })));
    else setItems((list) => list.map((i) => (i.id === id ? { ...i, readAt: "now" } : i)));
    await refreshCount();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={unread > 0 ? t("notif.bell", { count: unread }) : t("notif.bellNone")}
        onClick={() => {
          setOpen(true);
          void load(null);
        }}
      >
        🔔{unread > 0 ? <span className="ms-1 tabular-nums">{unread}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("notif.title")}</DialogTitle>
          </DialogHeader>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("notif.empty")}</p>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => mark("all")}
              >
                {t("notif.markAll")}
              </Button>
              <ul className="flex max-h-96 flex-col divide-y overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-2 py-2">
                    <Link
                      href={n.link}
                      className={`flex flex-col text-sm ${n.readAt ? "text-muted-foreground" : "font-medium"}`}
                      onClick={() => {
                        setOpen(false);
                        if (!n.readAt) void mark(n.id);
                      }}
                    >
                      <span className="text-xs uppercase">
                        {t(`notif.type.${n.type}` as MessageKey)}
                      </span>
                      {n.title}
                    </Link>
                    {!n.readAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("notif.markRead", { title: n.title })}
                        onClick={() => mark(n.id)}
                      >
                        ✓
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {cursor ? (
                <Button variant="ghost" size="sm" onClick={() => load(cursor)}>
                  {t("notif.more")}
                </Button>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
