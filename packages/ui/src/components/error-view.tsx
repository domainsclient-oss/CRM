"use client";

import { useEffect, useRef } from "react";
import { tBase as t } from "@crm/shared/i18n/base";

// Shared fallback for error boundaries (requirements/06 §9).
// Error boundaries load on every page, so this stays dependency-light: a plain <button> with the
// default Button look instead of the Button component (TC-PERF-001 budget).
// Shows only a generic message and the server-log digest — never error details.
export function ErrorView({
  digest,
  onRetry,
}: {
  digest?: string | undefined;
  onRetry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Move focus to the heading so screen-reader users hear the error (06 §8.2).
    headingRef.current?.focus();
  }, []);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center"
    >
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
        {t("page.error.title")}
      </h1>
      <p className="text-muted-foreground">{t("page.error.body")}</p>
      {digest ? (
        <p className="text-sm text-muted-foreground">
          {t("common.supportReference", { requestId: digest })}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
