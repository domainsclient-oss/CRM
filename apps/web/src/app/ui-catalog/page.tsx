import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { t } from "@crm/shared/i18n";
import { Toaster } from "@crm/ui/components/sonner";
import { Catalog } from "./catalog";

// Development-only component gallery (T-01-08); used for visual regression later (TC-VIS-001).
export const metadata: Metadata = {
  title: t("uiCatalog.title"),
  robots: { index: false, follow: false },
};

export default function UiCatalogPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main id="main">
      <Catalog />
      <Toaster />
    </main>
  );
}
