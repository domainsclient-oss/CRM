import { Skeleton } from "@crm/ui/components/skeleton";
import { t } from "@crm/shared/i18n";

// Route-level loading state (06 §9): skeleton shaped like a page (title + content) to avoid layout
// shift; announced as busy.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("common.loading")}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
