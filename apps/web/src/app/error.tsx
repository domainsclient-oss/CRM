"use client";

import { ErrorView } from "@crm/ui/components/error-view";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main" className="flex flex-1 flex-col">
      <ErrorView digest={error.digest} onRetry={retry} />
    </main>
  );
}
