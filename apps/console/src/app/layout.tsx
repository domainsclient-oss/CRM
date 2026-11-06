import type { Metadata } from "next";
import { Toaster } from "@crm/ui/components/sonner";
import { t } from "@crm/shared/i18n";
import "./globals.css";

// Platform (console.*) and agency (partners.*) consoles — requirements/02 §2, ADR-018.
// Never indexable (requirements/07 §1).
export const metadata: Metadata = {
  title: t("console.title"),
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          {t("common.skipToContent")}
        </a>
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
