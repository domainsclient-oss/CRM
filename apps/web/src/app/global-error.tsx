"use client";

import "./globals.css";
import { ErrorView } from "@crm/ui/components/error-view";
import { tBase as t } from "@crm/shared/i18n/base";

// Replaces the root layout when it fails, so it renders its own document.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <title>{t("page.error.title")}</title>
        <main>
          <ErrorView digest={error.digest} onRetry={retry} />
        </main>
      </body>
    </html>
  );
}
