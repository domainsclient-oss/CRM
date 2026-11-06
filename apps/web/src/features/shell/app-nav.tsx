"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@crm/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@crm/ui/components/dialog";
import { t } from "@crm/shared/i18n";

// Primary navigation (06 §5.1): sidebar on large screens, focus-trapped drawer below `lg`.
// The current page is marked with aria-current.

export type NavLink = [href: string, label: string];

function isCurrent(href: string, pathname: string, search: string): boolean {
  const [path, query] = href.split("?");
  if (query) return pathname === path && search === query;
  if (path === "/") return pathname === "/";
  // "Contacts" is not current on the Customers view (filtered contacts).
  if (path === "/contacts" && search.includes("value=customer")) return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function NavList({ links, onNavigate }: { links: NavLink[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <ul className="flex flex-col gap-0.5">
      {links.map(([href, label]) => {
        const current = isCurrent(href, pathname, search);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              {...(onNavigate ? { onClick: onNavigate } : {})}
              className={`flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-muted ${
                current ? "bg-muted font-medium" : ""
              }`}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close after navigation completes.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden" aria-label={t("nav.open")}>
          ☰
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:top-0 sm:left-0 sm:h-dvh sm:max-w-xs sm:translate-x-0 sm:translate-y-0 sm:rounded-none">
        <DialogTitle>{t("nav.main")}</DialogTitle>
        <DialogDescription className="sr-only">{t("nav.main")}</DialogDescription>
        <nav aria-label={t("nav.main")}>
          <NavList links={links} onNavigate={() => setOpen(false)} />
        </nav>
      </DialogContent>
    </Dialog>
  );
}

/** Move focus to the page heading after client-side navigation (06 §8.2). */
export function RouteFocus() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [pathname]);
  return null;
}
