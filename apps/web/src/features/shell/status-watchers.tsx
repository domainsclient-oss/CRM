"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@crm/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crm/ui/components/dialog";
import { SESSION_EXPIRED_EVENT } from "@crm/shared/auth-messages";
import { t } from "@crm/shared/i18n";

// Cross-cutting states (06 §9): offline banner, session-expired dialog, user theme.

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Persistent banner while offline; nothing is queued (MVP) but form state stays in memory. */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <p role="alert" className="border-b bg-destructive px-4 py-2 text-sm text-white">
      {t("app.offline")}
    </p>
  );
}

/**
 * A mutation returned UNAUTHENTICATED (session revoked/expired): explain and offer to sign in in a
 * new tab, so the page — and any unsaved form input — stays as it is.
 */
export function SessionExpiredDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onExpired = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("app.sessionExpired.title")}</DialogTitle>
          <DialogDescription>{t("app.sessionExpired.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.close")}
          </Button>
          <Button asChild>
            <a href="/login" target="_blank" rel="noopener">
              {t("app.sessionExpired.signIn")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Applies the user's theme preference (FR-SET-002) via the `dark` class — no inline script. */
export function ThemeApplier({ theme }: { theme: "system" | "light" | "dark" }) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return null;
}
